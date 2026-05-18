import { VoiceState, VoiceChannel, ChannelType, TextChannel } from 'discord.js';
import { RecordingManager } from '../utils/recordingManager';
import { autoChannels }     from '../commands/autoChannels';
import { createLogger }     from '../utils/logger';

const log = createLogger('VoiceState');

// Debounce map: channelId → timer
// When multiple voice state events fire in rapid succession (e.g. all 3 users
// joining at once each fires its own event), we wait 1.5 s and only act once.
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 1500;

export function onVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
  manager:  RecordingManager,
): void {
  // Collect every auto-record channel touched by this event
  const toCheck = new Set<VoiceChannel>();
  if (oldState.channel?.type === ChannelType.GuildVoice &&
      autoChannels.has(oldState.channel.id))
    toCheck.add(oldState.channel as VoiceChannel);
  if (newState.channel?.type === ChannelType.GuildVoice &&
      autoChannels.has(newState.channel.id))
    toCheck.add(newState.channel as VoiceChannel);

  for (const ch of toCheck) {
    // Cancel any pending debounce for this channel and restart it
    const existing = debounceTimers.get(ch.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      debounceTimers.delete(ch.id);
      handleChannel(ch, manager);
    }, DEBOUNCE_MS);

    debounceTimers.set(ch.id, timer);
  }
}

async function handleChannel(ch: VoiceChannel, manager: RecordingManager): Promise<void> {
  // Re-fetch the channel so the member list is current
  try { await ch.fetch(); } catch { /* ignore, use cached */ }

  const humans    = ch.members.filter(m => !m.user.bot).size;
  const recording = manager.isRecording(ch.id);
  const connecting = manager.isConnecting(ch.id);

  log.info(`#${ch.name}: ${humans} human(s) | recording=${recording} | connecting=${connecting}`);

  if (humans >= 2 && !recording && !connecting) {
    log.info(`Auto-starting recording in #${ch.name}`);

    const guild  = ch.guild;
    const me     = guild.members.me;
    const textCh = (
      guild.channels.cache.find(
        c => c.type === ChannelType.GuildText &&
             (!me || c.permissionsFor(me)?.has('SendMessages')),
      ) ?? null
    ) as TextChannel | null;

    const result = await manager.startRecording({
      channel: ch, initiatedBy: null, notifyChannel: textCh,
    });
    log.info(`Start result: ${result.message}`);

  } else if (humans < 2 && recording) {
    log.info(`Auto-stopping #${ch.name} — only ${humans} human(s) left`);
    await manager.stopRecording(ch.id, 'all users left');
  }
}
