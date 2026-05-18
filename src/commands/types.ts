import {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { RecordingManager } from '../utils/recordingManager';

// A structural type instead of SlashCommandBuilder avoids the variance
// errors in discord.js v14.14+ where .addChannelOption() etc. narrows
// the return type to SlashCommandOptionsOnlyBuilder.
export interface BotCommand {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction, manager: RecordingManager): Promise<void>;
}
