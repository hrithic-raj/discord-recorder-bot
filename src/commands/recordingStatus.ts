import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  EmbedBuilder, Colors,
} from 'discord.js';
import { BotCommand }       from './types';
import { RecordingManager } from '../utils/recordingManager';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('recordingstatus')
    .setDescription('Show all active recordings.'),

  async execute(i: ChatInputCommandInteraction, manager: RecordingManager) {
    const sessions = manager.getSessions();
    if (sessions.size === 0) {
      await i.reply({ content: '📭 No active recordings.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder().setTitle('🎙️ Active Recordings').setColor(Colors.Red).setTimestamp();
    for (const [, s] of sessions) {
      const sec = Math.floor((Date.now() - s.startedAt.getTime()) / 1000);
      const dur = `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
      // Access userNames via cast since the field is not in the public interface
      const names = [...(s as unknown as { userNames: Map<string,string> }).userNames.values()];
      embed.addFields({
        name: `#${s.channel.name}`,
        value: `⏱ \`${dur}\`  |  👤 ${s.initiatedBy ?? 'Auto'}  |  🎤 ${names.join(', ') || '(none yet)'}`,
      });
    }
    await i.reply({ embeds: [embed] });
  },
};
