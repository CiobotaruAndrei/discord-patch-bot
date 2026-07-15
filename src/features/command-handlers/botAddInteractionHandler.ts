import type { CommandHandler } from "../command-registry/commandHandler.js";
import botAddRepository from "../moderation/botAddRepository.js";
import type { BotAddPermissionRecord } from "../moderation/botAddRepository.js";

type Channel = { send?: (payload: unknown) => Promise<unknown> };
type Guild = {
  id: string;
  ownerId?: string;
  channels?: { fetch?: (id: string) => Promise<Channel | null> };
};
type Interaction = {
  commandName?: string;
  customId?: string;
  guild?: Guild | null;
  user?: { id?: string; username?: string } | null;
  options?: { getString(name: string, required?: boolean): string | null };
  isChatInputCommand?: () => boolean;
  isButton?: () => boolean;
  reply(payload: unknown): Promise<unknown>;
  update?: (payload: unknown) => Promise<unknown>;
};
type Model = Parameters<typeof botAddRepository.getBotAddState>[0];
type Deps = {
  GuildModel: Model;
  getGuildSettings: (guildId: string) => Promise<{ botAddAlertChannelId?: string | null; botAddProtectionEnabled?: boolean } | null>;
  safeDefer?: (interaction: Interaction, ephemeral?: boolean) => Promise<void>;
  safeEdit?: (interaction: Interaction, payload: unknown) => Promise<unknown>;
};

function requestId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function validBotId(value: string): boolean { return /^\d{17,20}$/.test(value); }
function owner(interaction: Interaction): boolean { return Boolean(interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user?.id); }
function buttons(id: string): unknown[] {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: "Da, permit", custom_id: `bot-add:approve:${id}` },
    { type: 2, style: 4, label: "Nu, refuz", custom_id: `bot-add:reject:${id}` }
  ] }];
}
function display(record: BotAddPermissionRecord): string {
  const expiry = record.expiresAt ? `<t:${Math.floor(new Date(record.expiresAt).getTime() / 1000)}:R>` : "-";
  return `bot ${record.botId} · solicitant <@${record.requesterId}> · ${record.status} · expira ${expiry}`;
}

function isBotAddInteraction(interaction: Interaction): boolean {
  if (interaction?.isButton?.() === true) return typeof interaction.customId === "string" && interaction.customId.startsWith("bot-add:");
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  return interaction.commandName === "bot-add-request" || interaction.commandName === "bot-add-permissions";
}

function buildCommandHandler(deps: Deps): CommandHandler<Interaction> {
  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    if (!guild || !interaction.user?.id) return interaction.reply({ content: "Comanda este disponibila doar pe server." });
    if (interaction.isButton?.() === true) {
      const match = /^(?:bot-add):(approve|reject):([^:]+)$/.exec(interaction.customId ?? "");
      if (!match) return undefined;
      if (!owner(interaction)) return interaction.reply({ content: "Doar proprietarul serverului poate aproba solicitarile.", ephemeral: true });
      const record = await botAddRepository.resolveBotAddRequest(deps.GuildModel, guild.id, match[2], match[1] === "approve" ? "approved" : "rejected", interaction.user.id);
      const content = record ? `${match[1] === "approve" ? "Aprobata" : "Respinsa"}: ${display(record)}` : "Solicitarea nu mai este activa sau a expirat.";
      return interaction.update ? interaction.update({ content, components: [] }) : interaction.reply({ content, ephemeral: true });
    }
    const command = interaction.commandName;
    if (command === "bot-add-permissions") {
      const records = (await botAddRepository.getBotAddState(deps.GuildModel, guild.id)).botAddPermissions;
      const active = records.filter(record => record.status === "pending" || record.status === "approved");
      return interaction.reply({ content: active.length ? active.map(display).join("\n") : "Nu exista solicitari sau permisiuni active." });
    }
    const settings = await deps.getGuildSettings(guild.id).catch(() => null);
    if (!settings?.botAddProtectionEnabled) return interaction.reply({ content: "Protectia bot-add nu este activa.", ephemeral: true });
    const botId = interaction.options?.getString("bot-id", true)?.trim() ?? "";
    if (!validBotId(botId)) return interaction.reply({ content: "ID-ul botului trebuie sa contina 17-20 cifre.", ephemeral: true });
    const record = await botAddRepository.createBotAddRequest(deps.GuildModel, guild.id, {
      requestId: requestId(), botId, requesterId: interaction.user.id, requestedAt: new Date()
    });
    const alertChannel = settings.botAddAlertChannelId && guild.channels?.fetch ? await guild.channels.fetch(settings.botAddAlertChannelId).catch(() => null) : null;
    if (alertChannel?.send) await alertChannel.send({ content: `Solicitare aprobare bot nou: ${display(record)}.`, components: buttons(record.requestId) });
    return interaction.reply({ content: "Solicitarea a fost trimisa proprietarului serverului.", ephemeral: true });
  }
  return { canHandle: (interaction: unknown): interaction is Interaction => isBotAddInteraction(interaction as Interaction), handle };
}

export default { buildCommandHandler };
