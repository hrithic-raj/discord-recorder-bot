import {
  VoiceChannel, GuildMember, TextChannel,
  EmbedBuilder, Colors,
} from 'discord.js';
import {
  joinVoiceChannel, VoiceConnection,
  VoiceConnectionStatus, EndBehaviorType,
  getVoiceConnection,
} from '@discordjs/voice';
import path from 'path';
import fs   from 'fs';
import { config }        from '../config';
import { mixAndSave }    from './audioMixer';
import { DriveUploader } from './driveUploader';
import { createLogger }  from './logger';

const OpusScript = require('opusscript') as {
  new (sampleRate: number, channels: number, application: number): {
    decode(buf: Buffer): Buffer;
  };
  Application: { AUDIO: number; VOIP: number; RESTRICTED_LOWDELAY: number };
};

const log = createLogger('RecordingManager');

interface Session {
  connection:    VoiceConnection;
  channel:       VoiceChannel;
  startedAt:     Date;
  initiatedBy:   GuildMember | null;
  notifyChannel: TextChannel | null;
  outputPath:    string;
  userBuffers:   Map<string, Buffer>;
  userNames:     Map<string, string>;
  watchdog:      NodeJS.Timeout;
  /** True once the connection has fully reached Ready state */
  ready:         boolean;
}

export class RecordingManager {
  private sessions  = new Map<string, Session>();
  /** Channels currently in the middle of connecting – blocks duplicate attempts */
  private connecting = new Set<string>();

  private uploader = new DriveUploader(
    config.google.credentialsFile,
    config.google.driveFolderId,
  );

  isRecording(channelId: string): boolean           { return this.sessions.has(channelId); }
  isConnecting(channelId: string): boolean          { return this.connecting.has(channelId); }
  getSessions(): ReadonlyMap<string, Session>       { return this.sessions; }

  // ── Start ──────────────────────────────────────────────────────────────

  async startRecording(opts: {
    channel:       VoiceChannel;
    initiatedBy:   GuildMember | null;
    notifyChannel: TextChannel | null;
  }): Promise<{ ok: boolean; message: string }> {
    const { channel, initiatedBy, notifyChannel } = opts;
    const cid = channel.id;

    // Gate: already recording OR already in the middle of connecting
    if (this.sessions.has(cid))
      return { ok: false, message: `⚠️ Already recording **${channel.name}**.` };
    if (this.connecting.has(cid))
      return { ok: false, message: `⏳ Already connecting to **${channel.name}**…` };

    this.connecting.add(cid);

    try {
      return await this._doConnect(opts);
    } finally {
      // Always remove the lock, whether we succeeded or failed
      this.connecting.delete(cid);
    }
  }

  private async _doConnect(opts: {
    channel:       VoiceChannel;
    initiatedBy:   GuildMember | null;
    notifyChannel: TextChannel | null;
  }): Promise<{ ok: boolean; message: string }> {
    const { channel, initiatedBy, notifyChannel } = opts;
    const cid = channel.id;

    // Safe filename: strip all non-ASCII and special chars
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = channel.name
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'channel';
    const outputPath = path.resolve(config.recording.dir, `${safeName}_${ts}.wav`);

    // If there's a stale connection for this guild that isn't one of our
    // active sessions, destroy it quietly before joining
    const existing = getVoiceConnection(channel.guild.id);
    if (existing && !this.sessions.has(cid)) {
      log.info('Cleaning up stale voice connection.');
      existing.destroy();
      await sleep(600);
    }

    let connection: VoiceConnection;
    try {
      connection = joinVoiceChannel({
        channelId:      cid,
        guildId:        channel.guild.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        adapterCreator: channel.guild.voiceAdapterCreator as any,
        selfDeaf:  false,
        selfMute:  true,
      });

      // Wait for the connection to be fully ready
      await waitForReady(connection, 20_000);
    } catch (err) {
      log.error(`Failed to join "${channel.name}"`, err);
      try { getVoiceConnection(channel.guild.id)?.destroy(); } catch { /* ignore */ }
      return {
        ok: false,
        message: `❌ Could not connect to **${channel.name}**.\n` +
                 `Check I have **Connect** and **View Channel** permissions there.`,
      };
    }

    // ── Connection is Ready — set up audio capture ──

    const userBuffers = new Map<string, Buffer>();
    const userNames   = new Map<string, string>();
    const receiver    = connection.receiver;

    const onSpeakingStart = (userId: string) => {
      if (receiver.subscriptions.has(userId)) return;
      const member = channel.members.get(userId);
      if (member?.user.bot) return;

      userNames.set(userId, member?.displayName ?? userId);
      log.info(`Subscribed to audio: ${userNames.get(userId)}`);

      const decoder = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
      const chunks: Buffer[] = [];

      const stream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 500 },
      });

      stream.on('data', (packet: Buffer) => {
        try { chunks.push(Buffer.from(decoder.decode(packet))); }
        catch { /* drop bad packet */ }
      });

      stream.on('end', () => {
        if (!chunks.length) return;
        const prev = userBuffers.get(userId) ?? Buffer.alloc(0);
        userBuffers.set(userId, Buffer.concat([prev, ...chunks]));
        log.info(`Saved audio chunk for ${userNames.get(userId)} (${chunks.length} packets)`);
      });
    };

    receiver.speaking.on('start', onSpeakingStart);

    const watchdog = setTimeout(() => {
      log.warn(`Watchdog: stopping ${channel.name} after ${config.recording.maxHours}h`);
      this.stopRecording(cid, 'max duration exceeded');
    }, config.recording.maxHours * 3_600_000);

    const session: Session = {
      connection, channel, startedAt: new Date(),
      initiatedBy, notifyChannel,
      outputPath, userBuffers, userNames,
      watchdog, ready: true,
    };
    this.sessions.set(cid, session);

    // Only NOW attach the disconnect handler — AFTER the session is registered
    // and AFTER the connection is confirmed ready.  Attaching it earlier caused
    // the handler to fire during normal connection setup (Signalling→Connecting
    // briefly shows Disconnected on some network paths) and immediately tear
    // down the session we just created.
    connection.on('stateChange' as any, (_: any, newState: any) => {
      if (newState.status === VoiceConnectionStatus.Disconnected) {
        if (!this.sessions.has(cid)) return; // already stopped
        log.warn(`Unexpected disconnect from #${channel.name} — stopping.`);
        this.stopRecording(cid, 'unexpected disconnect');
      }
    });

    log.info(`Recording started: #${channel.name} → ${outputPath}`);
    const msg = `🔴 Recording started in **${channel.name}**.`;
    if (notifyChannel) await safeSend(notifyChannel, msg);
    return { ok: true, message: msg };
  }

  // ── Stop ───────────────────────────────────────────────────────────────

  async stopRecording(channelId: string, reason = 'manual'): Promise<void> {
    const s = this.sessions.get(channelId);
    if (!s) return;

    this.sessions.delete(channelId); // remove first to prevent re-entrant calls
    clearTimeout(s.watchdog);
    log.info(`Stopping: #${s.channel.name} (${reason})`);

    // Wait for in-flight audio stream 'end' events to flush
    await sleep(1000);

    try {
      s.connection.receiver.speaking.removeAllListeners();
      s.connection.destroy();
    } catch { /* already gone */ }

    const hasAudio = s.userBuffers.size > 0;
    log.info(`Captured audio from ${s.userBuffers.size} user(s): ${[...s.userNames.values()].join(', ') || 'none'}`);

    if (!hasAudio) {
      const msg = `⏹️ Recording stopped for **${s.channel.name}** — no audio was captured.`;
      log.warn(msg);
      if (s.notifyChannel) await safeSend(s.notifyChannel, msg);
      return;
    }

    mixAndSave(s.userBuffers, s.outputPath);

    if (!fs.existsSync(s.outputPath)) {
      log.error(`WAV write failed: ${s.outputPath}`);
      if (s.notifyChannel)
        await safeSend(s.notifyChannel, `❌ Failed to write recording for **${s.channel.name}**.`);
      return;
    }

    if (s.notifyChannel)
      await safeSend(s.notifyChannel, `⏹️ Recording stopped for **${s.channel.name}**. Uploading to Google Drive…`);

    this.uploadAndNotify(s).catch(err => log.error('uploadAndNotify failed', err));
  }

  // ── Upload ─────────────────────────────────────────────────────────────

  private async uploadAndNotify(s: Session): Promise<void> {
    const link = await this.uploader.upload({
      filePath:    s.outputPath,
      guildName:   s.channel.guild?.name ?? 'Unknown',
      channelName: s.channel.name,
      startedAt:   s.startedAt,
    });

    if (link && s.notifyChannel) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Recording Uploaded to Google Drive')
        .setColor(Colors.Green)
        .setTimestamp()
        .addFields(
          { name: 'Channel',      value: `\`${s.channel.name}\``,                    inline: true },
          { name: 'Duration',     value: fmtDuration(s.startedAt),                   inline: true },
          { name: 'Started by',   value: s.initiatedBy?.toString() ?? 'Auto',        inline: true },
          { name: 'Participants', value: [...s.userNames.values()].join(', ') || '—'              },
          { name: '📁 Drive',     value: `[Open File](${link})`                                   },
        );
      await safeSend(s.notifyChannel, undefined, embed);
    } else if (!link && s.notifyChannel) {
      await safeSend(s.notifyChannel,
        `❌ Drive upload failed. File saved locally: \`${s.outputPath}\``);
    }

    if (link) { try { fs.unlinkSync(s.outputPath); } catch { /* ignore */ } }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Wait for a voice connection to reach Ready.
 * Correctly handles the Signalling → Connecting → Ready progression
 * without being tripped by transient Disconnected states during setup.
 */
function waitForReady(conn: VoiceConnection, timeoutMs: number): Promise<void> {
  if (conn.state.status === VoiceConnectionStatus.Ready) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for voice connection after ${timeoutMs}ms`));
    }, timeoutMs);

    function onStateChange(_: any, newState: any) {
      if (newState.status === VoiceConnectionStatus.Ready) {
        cleanup();
        resolve();
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        cleanup();
        reject(new Error('Voice connection destroyed before becoming ready'));
      }
      // Deliberately ignore Disconnected/Connecting/Signalling during setup
    }

    function cleanup() {
      clearTimeout(timer);
      conn.removeListener('stateChange' as any, onStateChange);
    }

    conn.on('stateChange' as any, onStateChange);
  });
}

async function safeSend(ch: TextChannel, content?: string, embed?: EmbedBuilder) {
  try {
    embed ? await ch.send({ embeds: [embed] }) : await ch.send(content!);
  } catch { /* channel unavailable */ }
}

function fmtDuration(from: Date): string {
  const s   = Math.floor((Date.now() - from.getTime()) / 1000);
  const h   = Math.floor(s / 3600).toString().padStart(2, '0');
  const m   = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
