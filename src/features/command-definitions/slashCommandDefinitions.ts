import type { CurrencyRegistry } from "../../types.js";
import type { PermissionsBitFieldLike, SlashChoice, SlashCommandJson, SlashDefinitionTools } from "./slashDefinitionTools.js";
import { buildAdminCommandDefinitions } from "./adminCommandDefinitions.js";
import { buildCoreCommandDefinitions } from "./coreCommandDefinitions.js";
import { buildDealsCommandDefinitions } from "./dealsCommandDefinitions.js";
import { buildGameInfoCommandDefinitions } from "./gameInfoCommandDefinitions.js";
import { buildNotificationCommandDefinitions } from "./notificationCommandDefinitions.js";
import { buildYouTubeCommandDefinitions } from "./youtubeCommandDefinitions.js";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface SlashCommandContext {
  SlashCommandBuilder: typeof import("discord.js").SlashCommandBuilder;
  PermissionsBitField: PermissionsBitFieldLike;
  Routes: {
    applicationCommands(clientId: string): string;
    applicationGuildCommands(clientId: string, guildId: string): string;
  };
  REST: new (options: { version: string }) => {
    setToken(token: string): {
      put(route: string, options: { body: SlashCommandJson[] }): Promise<unknown>;
    };
  };
  SUPPORTED_CURRENCIES: CurrencyRegistry;
  logger: Logger;
  env?: { DISCORD_DEV_GUILD_ID?: string };
  CURRENCY_CHOICES?: SlashChoice[];
  buildSlashCommandDefinitions?: () => SlashCommandJson[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<void>;
}

type SlashCommandDefinitionsDeps = Pick<SlashCommandContext, "SlashCommandBuilder" | "PermissionsBitField" | "Routes" | "REST" | "SUPPORTED_CURRENCIES" | "logger" | "env">;

interface SlashCommandDefinitions {
  CURRENCY_CHOICES: SlashChoice[];
  buildSlashCommandDefinitions: () => SlashCommandJson[];
  registerSlashCommands: (token: string, clientId: string) => Promise<void>;
}

function createSlashCommandDefinitions(deps: SlashCommandDefinitionsDeps): SlashCommandDefinitions {
  const { SlashCommandBuilder, PermissionsBitField, Routes, REST, SUPPORTED_CURRENCIES, logger, env } = deps;

  const CURRENCY_CHOICES: SlashChoice[] = Object.keys(SUPPORTED_CURRENCIES).map(currency => ({
    name: currency,
    value: currency
  }));

  const tools: SlashDefinitionTools = { SlashCommandBuilder, PermissionsBitField, CURRENCY_CHOICES };

  function buildSlashCommandDefinitions(): SlashCommandJson[] {
    return [
      ...buildCoreCommandDefinitions(tools),
      ...buildAdminCommandDefinitions(tools),
      ...buildNotificationCommandDefinitions(tools),
      ...buildDealsCommandDefinitions(tools),
      ...buildGameInfoCommandDefinitions(tools),
      ...buildYouTubeCommandDefinitions(tools)
    ].map(command => command.toJSON())
      .map(definition => definition.default_member_permissions === PermissionsBitField.Flags.Administrator.toString()
        ? { ...definition, dm_permission: false }
        : definition);
  }

  async function registerSlashCommands(token: string, clientId: string): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(token);
    const body = buildSlashCommandDefinitions();
    const devGuildId = env?.DISCORD_DEV_GUILD_ID;
    if (devGuildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body });
      logger("INFO", "SLASH", `Inregistrate ${body.length} slash commands GUILD-scoped pe ${devGuildId} (propagare instant).`);
      return;
    }
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger("INFO", "SLASH", `Inregistrate ${body.length} slash commands global (propagare ~1h).`);
  }

  return { CURRENCY_CHOICES, buildSlashCommandDefinitions, registerSlashCommands };
}

type SlashCommandsInstaller = ((target: SlashCommandContext) => void) & {
  createSlashCommandDefinitions: typeof createSlashCommandDefinitions;
};

const attachSlashCommands = ((target: SlashCommandContext): void => {
  Object.assign(target, createSlashCommandDefinitions(target));
}) as SlashCommandsInstaller;

attachSlashCommands.createSlashCommandDefinitions = createSlashCommandDefinitions;

export default attachSlashCommands;
