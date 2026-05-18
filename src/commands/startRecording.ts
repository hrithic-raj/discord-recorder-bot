import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  VoiceChannel, TextChannel, ChannelType,
} from 'discord.js';
import { BotCommand }        from './types';
import { RecordingManager }  from '../utils/recordingManager';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('startrecording')
    .setDescription('Start recording a voice channel.')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Voice channel to record (defaults to your current VC)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false)
    ),

  async execute(i: ChatInputCommandInteraction, manager: RecordingManager) {
    await i.deferReply();

    let target = i.options.getChannel('channel') as VoiceChannel | null;
    if (!target) {
      const vc = i.guild?.members.cache.get(i.user.id)?.voice.channel;
      if (!vc || vc.type !== ChannelType.GuildVoice) {
        await i.editReply('❌ Join a voice channel first, or pass the `channel` option.');
        return;
      }
      target = vc as VoiceChannel;
    }

    const notify = i.channel?.type === ChannelType.GuildText ? (i.channel as TextChannel) : null;
    const member = i.guild?.members.cache.get(i.user.id) ?? null;

    const result = await manager.startRecording({ channel: target, initiatedBy: member, notifyChannel: notify });
    await i.editReply(result.message);
  },
};
