import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  VoiceChannel, EmbedBuilder, Colors,
  PermissionFlagsBits, ChannelType,
} from 'discord.js';
import { BotCommand }          from './types';
import { RecordingManager }    from '../utils/recordingManager';
import {
  addAutoRecordChannel,
  removeAutoRecordChannel,
  getAutoRecordChannels,
} from '../utils/storage';

// Shared in-memory set – populated at startup from storage + .env
export const autoChannels: Set<string> = getAutoRecordChannels();

// ── /addautochannel ────────────────────────────────────────────────────────────

export const addAutoChannelCmd: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('addautochannel')
    .setDescription('[Admin] Auto-record a VC when 2+ users join.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true)
    ),

  async execute(i: ChatInputCommandInteraction) {
    const ch = i.options.getChannel('channel', true) as VoiceChannel;
    if (autoChannels.has(ch.id)) {
      await i.reply({ content: `⚠️ **${ch.name}** is already set to auto-record.`, ephemeral: true });
      return;
    }
    autoChannels.add(ch.id);
    addAutoRecordChannel(ch.id);
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('✅ Auto-Record Channel Added')
          .setDescription(`**${ch.name}** will auto-record whenever **2 or more users** are present.`)
          .setColor(Colors.Green),
      ],
    });
  },
};

// ── /removeautochannel ─────────────────────────────────────────────────────────

export const removeAutoChannelCmd: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('removeautochannel')
    .setDescription('[Admin] Remove a VC from auto-recording.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true)
    ),

  async execute(i: ChatInputCommandInteraction) {
    const ch = i.options.getChannel('channel', true) as VoiceChannel;
    if (!autoChannels.has(ch.id)) {
      await i.reply({ content: `⚠️ **${ch.name}** is not an auto-record channel.`, ephemeral: true });
      return;
    }
    autoChannels.delete(ch.id);
    removeAutoRecordChannel(ch.id);
    await i.reply(`🗑️ **${ch.name}** removed from auto-record channels.`);
  },
};

// ── /listautochannels ──────────────────────────────────────────────────────────

export const listAutoChannelsCmd: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('listautochannels')
    .setDescription('List all voice channels set to auto-record.'),

  async execute(i: ChatInputCommandInteraction) {
    const lines = [...autoChannels].map(id => {
      const ch = i.guild?.channels.cache.get(id);
      return `• **${ch?.name ?? 'Unknown'}** (\`${id}\`)`;
    });
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📋 Auto-Record Channels')
          .setColor(lines.length ? Colors.Blue : Colors.Grey)
          .setDescription(lines.length ? lines.join('\n') : 'None configured. Use `/addautochannel` to add one.'),
      ],
    });
  },
};
