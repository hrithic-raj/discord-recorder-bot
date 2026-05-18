import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  VoiceChannel, ChannelType,
} from 'discord.js';
import { BotCommand }       from './types';
import { RecordingManager } from '../utils/recordingManager';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('stoprecording')
    .setDescription('Stop recording a voice channel.')
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Voice channel to stop (defaults to your current VC)')
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

    if (!manager.isRecording(target.id)) {
      await i.editReply(`⚠️ **${target.name}** is not being recorded.`);
      return;
    }

    await i.editReply(`⏹️ Stopping **${target.name}**…`);
    await manager.stopRecording(target.id, 'manual stop');
  },
};
