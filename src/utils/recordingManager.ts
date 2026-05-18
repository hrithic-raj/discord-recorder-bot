import {
  VoiceChannel, GuildMember, TextChannel,
  EmbedBuilder, Colors,
} from 'discord.js';
import {
  joinVoiceChannel, VoiceConnection,
  VoiceConnectionStatus, EndBehaviorType,
  entersState, getVoiceConnection,
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
}

export class RecordingManager {
  private sessions   = new Map<string, Session>();
  private connecting = new Set<string>();
  /** channelId → timestamp of last failed connect — prevents instant retry loops */
  private cooldowns  = new Map<string, number>();
  private readonly COOLDOWN_MS = 30_000; // 30 s between retries after failure

  private uploader = new DriveUploader(
    config.google.credentialsFile,
    config.google.driveFolderId,
  );

  isRecording(channelId: string): boolean         { return this.sessions.has(channelId); }
  isConnecting(channelId: string): boolean        { return this.connecting.has(channelId); }
  getSessions(): ReadonlyMap<string, Session>     { return this.sessions; }

  isCoolingDown(channelId: string): boolean {
    const t = this.cooldowns.get(channelId);
    if (!t) return false;
    if (Date.now() - t > this.COOLDOWN_MS) {
      this.cooldowns.delete(channelId);
      return false;
    }
    return true;
  }

  // ── Start ──────────────────────────────────────────────────────────────

  async startRecording(opts: {
    channel:       VoiceChannel;
    initiatedBy:   GuildMember | null;
    notifyChannel: TextChannel | null;
  }): Promise<{ ok: boolean; message: string }> {
    const { channel } = opts;
    const cid = channel.id;

    if (this.sessions.has(cid))
      return { ok: false, message: `⚠️ Already recording **${channel.name}**.` };
    if (this.connecting.has(cid))
      return { ok: false, message: `⏳ Already connecting to **${channel.name}**…` };
    if (this.isCoolingDown(cid))
      return { ok: false, message: `⏳ Connection failed recently. Retrying in ${this.COOLDOWN_MS / 1000}s…` };

    this.connecting.add(cid);
    try {
      return await this._connect(opts);
    } finally {
      this.connecting.delete(cid);
    }
  }

  private async _connect(opts: {
    channel:       VoiceChannel;
    initiatedBy:   GuildMember | null;
    notifyChannel: TextChannel | null;
  }): Promise<{ ok: boolean; message: string }> {
    const { channel, initiatedBy, notifyChannel } = opts;
    const cid = channel.id;

    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = channel.name
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim().replace(/\s+/g, '_') || 'channel';
    const outputPath = path.resolve(config.recording.dir, `${safeName}_${ts}.wav`);

    // Destroy any pre-existing connection for this guild
    const stale = getVoiceConnection(channel.guild.id);
    if (stale) {
      log.info('Destroying stale connection.');
      stale.destroy();
      await sleep(800);
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

      // Handle the Connecting state first — the library requires this
      // when the connection starts in Signalling state
      if (connection.state.status !== VoiceConnectionStatus.Ready) {
        try {
          // Move through Signalling→Connecting first
          await entersState(connection, VoiceConnectionStatus.Connecting, 10_000);
        } catch {
          // Already past Connecting, that's fine
        }
        // Now wait for Ready (voice UDP handshake complete)
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      }

      log.info(`Voice connection ready for #${channel.name}`);
    } catch (err) {
      log.error(`Failed to join "${channel.name}"`, err);
      this.cooldowns.set(cid, Date.now());
      try { connection!.destroy(); } catch { /* ignore */ }
      try { getVoiceConnection(channel.guild.id)?.destroy(); } catch { /* ignore */ }
      return {
        ok: false,
        message: `❌ Could not connect to **${channel.name}**.\n` +
                 `This is usually a network/UDP issue, not a permissions issue.\n` +
                 `Check that port **UDP 50000–65535** is not blocked by your firewall.\n` +
                 `Will retry automatically in ${this.COOLDOWN_MS / 1000}s.`,
      };
    }

    // ── Connected — set up audio capture ──────────────────────────────────

    const userBuffers = new Map<string, Buffer>();
    const userNames   = new Map<string, string>();
    const receiver    = connection.receiver;

    receiver.speaking.on('start', (userId: string) => {
      if (receiver.subscriptions.has(userId)) return;
      const member = channel.members.get(userId);
      if (member?.user.bot) return;

      userNames.set(userId, member?.displayName ?? userId);
      log.info(`Capturing audio from: ${userNames.get(userId)}`);

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
        log.info(`Flushed audio for ${userNames.get(userId)} (${chunks.length} packets)`);
      });
    });

    // Watchdog: auto-stop after configured max hours
    const watchdog = setTimeout(() => {
      log.warn(`Watchdog: stopping ${channel.name} after ${config.recording.maxHours}h`);
      this.stopRecording(cid, 'max duration exceeded');
    }, config.recording.maxHours * 3_600_000);

    const session: Session = {
      connection, channel, startedAt: new Date(),
      initiatedBy, notifyChannel,
      outputPath, userBuffers, userNames, watchdog,
    };
    this.sessions.set(cid, session);

    // Attach disconnect handler only AFTER session is registered
    connection.on(VoiceConnectionStatus.Disconnected as any, () => {
      if (!this.sessions.has(cid)) return;
      log.warn(`Unexpected disconnect from #${channel.name}`);
      this.stopRecording(cid, 'unexpected disconnect');
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

    this.sessions.delete(channelId);
    clearTimeout(s.watchdog);
    log.info(`Stopping: #${s.channel.name} (${reason})`);

    await sleep(1000); // flush audio stream end events

    try {
      s.connection.receiver.speaking.removeAllListeners();
      s.connection.destroy();
    } catch { /* already gone */ }

    const hasAudio = s.userBuffers.size > 0;
    log.info(`Audio from ${s.userBuffers.size} user(s): ${[...s.userNames.values()].join(', ') || 'none'}`);

    if (!hasAudio) {
      const msg = `⏹️ Recording stopped for **${s.channel.name}** — no audio captured (no one spoke).`;
      if (s.notifyChannel) await safeSend(s.notifyChannel, msg);
      return;
    }

    mixAndSave(s.userBuffers, s.outputPath);

    if (!fs.existsSync(s.outputPath)) {
      if (s.notifyChannel)
        await safeSend(s.notifyChannel, `❌ Failed to write recording for **${s.channel.name}**.`);
      return;
    }

    if (s.notifyChannel)
      await safeSend(s.notifyChannel, `⏹️ Stopped **${s.channel.name}**. Uploading to Google Drive…`);

    this.uploadAndNotify(s).catch(err => log.error('uploadAndNotify failed', err));
  }

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
      await safeSend(s.notifyChannel, `❌ Drive upload failed. Saved locally: \`${s.outputPath}\``);
    }

    if (link) { try { fs.unlinkSync(s.outputPath); } catch { /* ignore */ } }
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function safeSend(ch: TextChannel, content?: string, embed?: EmbedBuilder) {
  try { embed ? await ch.send({ embeds: [embed] }) : await ch.send(content!); }
  catch { /* channel unavailable */ }
}

function fmtDuration(from: Date): string {
  const s   = Math.floor((Date.now() - from.getTime()) / 1000);
  const h   = Math.floor(s / 3600).toString().padStart(2, '0');
  const m   = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
