import { VoiceState, VoiceChannel, ChannelType, TextChannel } from 'discord.js';
import { RecordingManager } from '../utils/recordingManager';
import { autoChannels }     from '../commands/autoChannels';
import { createLogger }     from '../utils/logger';

const log = createLogger('VoiceState');

// Debounce: collapse rapid-fire events for the same channel into one action
const debounceTimers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2000;

export function onVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
  manager:  RecordingManager,
): void {
  const toCheck = new Set<VoiceChannel>();
  if (oldState.channel?.type === ChannelType.GuildVoice && autoChannels.has(oldState.channel.id))
    toCheck.add(oldState.channel as VoiceChannel);
  if (newState.channel?.type === ChannelType.GuildVoice && autoChannels.has(newState.channel.id))
    toCheck.add(newState.channel as VoiceChannel);

  for (const ch of toCheck) {
    const existing = debounceTimers.get(ch.id);
    if (existing) clearTimeout(existing);
    debounceTimers.set(ch.id, setTimeout(() => {
      debounceTimers.delete(ch.id);
      handleChannel(ch, manager).catch(err => log.error('handleChannel error', err));
    }, DEBOUNCE_MS));
  }
}

async function handleChannel(ch: VoiceChannel, manager: RecordingManager): Promise<void> {
  const humans     = ch.members.filter(m => !m.user.bot).size;
  const recording  = manager.isRecording(ch.id);
  const connecting = manager.isConnecting(ch.id);
  const cooldown   = manager.isCoolingDown(ch.id);

  log.info(`#${ch.name}: ${humans} humans | recording=${recording} connecting=${connecting} cooldown=${cooldown}`);

  if (humans >= 2 && !recording && !connecting && !cooldown) {
    log.info(`Auto-starting recording in #${ch.name}`);

    const me     = ch.guild.members.me;
    const textCh = (ch.guild.channels.cache.find(
      c => c.type === ChannelType.GuildText &&
           (!me || c.permissionsFor(me)?.has('SendMessages')),
    ) ?? null) as TextChannel | null;

    const result = await manager.startRecording({ channel: ch, initiatedBy: null, notifyChannel: textCh });
    if (!result.ok) log.warn(`Auto-start failed: ${result.message}`);

  } else if (humans < 2 && recording) {
    log.info(`Auto-stopping #${ch.name} — ${humans} human(s) left`);
    await manager.stopRecording(ch.id, 'all users left');
  }
}
