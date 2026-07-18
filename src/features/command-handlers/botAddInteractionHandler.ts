import type { CommandHandler } from "../command-registry/commandHandler.js";
import botAddRepository from "../moderation/botAddRepository.js";
import type { BotAddPermissionRecord } from "../moderation/botAddRepository.js";
import { sendTextPages } from "../command-presentation/textPagination.js";

type Channel = { send?: (payload: unknown) => Promise<unknown> };
type RequesterMember = { send?: (payload: unknown) => Promise<unknown> };
type Guild = {
  id: string;
  ownerId?: string;
  channels?: { fetch?: (id: string) => Promise<Channel | null> };
  members?: { fetch?: (id: string) => Promise<RequesterMember | null> };
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
  followUp?: (payload: unknown) => Promise<unknown>;
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
function relTime(value: Date | string | null | undefined): string {
  return value ? `<t:${Math.floor(new Date(value).getTime() / 1000)}:R>` : "-";
}
export function display(record: BotAddPermissionRecord): string {
  const respondedBy = record.ownerId ? ` de <@${record.ownerId}>` : "";
  const labels: Record<BotAddPermissionRecord["status"], string> = {
    pending: "in asteptare",
    approved: "aprobata",
    used: "folosita",
    rejected: "respinsa",
    expired: "expirata",
    cancelled: record.cancellationReason === "protection-stopped" ? "anulata la oprirea protectiei" : "anulata"
  };
  return `#${record.requestId} | bot ${record.botId} | solicitant <@${record.requesterId}> | status ${labels[record.status]} | cerut ${relTime(record.requestedAt)} | raspuns ${relTime(record.respondedAt)}${respondedBy} | expira ${relTime(record.expiresAt)} | folosit ${relTime(record.usedAt)} | anulat ${relTime(record.cancelledAt)}`;
}
function isActiveRecord(record: BotAddPermissionRecord, now: number): boolean {
  return (record.status === "pending" || record.status === "approved")
    && Boolean(record.expiresAt && new Date(record.expiresAt).getTime() > now);
}
export function orderBotAddRecords(records: readonly BotAddPermissionRecord[], now: number): BotAddPermissionRecord[] {
  return [...records].sort((left, right) => {
    const activeDelta = (isActiveRecord(right, now) ? 1 : 0) - (isActiveRecord(left, now) ? 1 : 0);
    if (activeDelta !== 0) return activeDelta;
    return new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime();
  });
}

function isBotAddInteraction(interaction: Interaction): boolean {
  if (interaction?.isButton?.() === true) return typeof interaction.customId === "string" && interaction.customId.startsWith("bot-add:");
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  return interaction.commandName === "bot-add-request" || interaction.commandName === "bot-add-permissions";
}

export function buildCommandHandler(deps: Deps): CommandHandler<Interaction> {
  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    if (!guild || !interaction.user?.id) return interaction.reply({ content: "Comanda este disponibila doar pe server.", ephemeral: true });
    if (interaction.isButton?.() === true) {
      const match = /^(?:bot-add):(approve|reject):([^:]+)$/.exec(interaction.customId ?? "");
      if (!match) return undefined;
      if (!owner(interaction)) return interaction.reply({ content: "Doar proprietarul serverului poate aproba solicitarile.", ephemeral: true });
      const record = await botAddRepository.resolveBotAddRequest(deps.GuildModel, guild.id, match[2], match[1] === "approve" ? "approved" : "rejected", interaction.user.id);
      if (!record) {
        const existing = (await botAddRepository.getBotAddState(deps.GuildModel, guild.id)).botAddPermissions.find(entry => entry.requestId === match[2]);
        const unavailable = existing?.status === "cancelled" && existing.cancellationReason === "protection-stopped"
          ? "Solicitarea a fost anulata la oprirea protectiei bot-add si nu mai poate fi aprobata."
          : "Solicitarea nu mai este activa sau a expirat.";
        return interaction.update ? interaction.update({ content: unavailable, components: [] }) : interaction.reply({ content: unavailable, ephemeral: true });
      }
      const decisionWord = match[1] === "approve" ? "Aprobata" : "Respinsa";
      const requesterNotice = match[1] === "approve"
        ? `solicitarea ta de adaugare bot a fost aprobata; ai o fereastra one-time pentru a adauga botul.`
        : `solicitarea ta de adaugare bot a fost respinsa de owner.`;
      const content = `${decisionWord}: ${display(record)}\n<@${record.requesterId}> ${requesterNotice}`;
      const allowedMentions = { parse: [], users: [record.requesterId] };
      const requester = guild.members?.fetch ? await guild.members.fetch(record.requesterId).catch(() => null) : null;
      const directDelivered = requester?.send
        ? await requester.send({ content: requesterNotice, allowedMentions: { parse: [] } }).then(() => true).catch(() => false)
        : false;
      const delivery = directDelivered ? "Notificare directa trimisa solicitantului." : "Notificarea directa nu a putut fi livrata; decizia ramane in acest canal.";
      const finalContent = `${content}\n${delivery}`;
      return interaction.update ? interaction.update({ content: finalContent, components: [], allowedMentions }) : interaction.reply({ content: finalContent, ephemeral: true, allowedMentions });
    }
    const command = interaction.commandName;
    if (command === "bot-add-permissions") {
      const records = (await botAddRepository.getBotAddState(deps.GuildModel, guild.id)).botAddPermissions;
      const ordered = orderBotAddRecords(records, Date.now());
      return sendTextPages(interaction, ordered.map(display), "Nu exista solicitari sau permisiuni bot-add.", true);
    }
    const settings = await deps.getGuildSettings(guild.id).catch(() => null);
    if (!settings?.botAddProtectionEnabled) return interaction.reply({ content: "Protectia bot-add nu este activa.", ephemeral: true });
    const botId = interaction.options?.getString("bot-id", true)?.trim() ?? "";
    if (!validBotId(botId)) return interaction.reply({ content: "ID-ul botului trebuie sa contina 17-20 cifre.", ephemeral: true });
    const record = await botAddRepository.createBotAddRequest(deps.GuildModel, guild.id, {
      requestId: requestId(), botId, requesterId: interaction.user.id, requestedAt: new Date()
    });
    const alertChannel = settings.botAddAlertChannelId && guild.channels?.fetch ? await guild.channels.fetch(settings.botAddAlertChannelId).catch(() => null) : null;
    if (!alertChannel?.send) return interaction.reply({ content: "Canalul de aprobare bot-add nu este disponibil.", ephemeral: true });
    const ownerId = guild.ownerId;
    await alertChannel.send({
      content: `${ownerId ? `<@${ownerId}> ` : ""}Solicitare aprobare bot nou: ${display(record)}.`,
      components: buttons(record.requestId),
      allowedMentions: ownerId ? { parse: [], users: [ownerId] } : { parse: [] }
    });
    return interaction.reply({ content: "Solicitarea a fost trimisa proprietarului serverului.", ephemeral: true });
  }
  return { canHandle: (interaction: unknown): interaction is Interaction => isBotAddInteraction(interaction as Interaction), handle };
}

export default { buildCommandHandler };
