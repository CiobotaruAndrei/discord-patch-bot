"use strict";

const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;

type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  options: {
    getString: (name: string) => string | null;
    getInteger?: (name: string) => number | null;
  };
};

type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

type HistoryKind = "update" | "discount";

interface HistoryEmbedRecord {
  kind: HistoryKind;
  gameKey: string;
  title: string;
  link: string;
  sentAt: Date;
}

type GetNotificationHistory = (guildId: string, kind: HistoryKind | "all", limit: number) => Promise<HistoryEmbedRecord[]>;

interface HistoryHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown>;
  getNotificationHistory: GetNotificationHistory;
  MessageFlags: { Ephemeral: number };
}

type HistoryContext = HistoryHandlerDeps & {
  handleInteraction?: NextInteractionHandler;
};

function mapHistoryKind(tip: string | null): HistoryKind | "all" {
  if (tip === "updates") return "update";
  if (tip === "reduceri") return "discount";
  return "all";
}

function truncateLabel(value: string, max: number): string {
  const clean = value.replace(/[[\]]/g, "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function escapeMarkdownLinkUrl(url: string): string {
  return url.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
}

function buildHistoryEmbed(records: HistoryEmbedRecord[], kind: HistoryKind | "all"): { title: string; description: string; color: number; footer: { text: string } } {
  const scopeLabel = kind === "update" ? "update-uri" : kind === "discount" ? "reduceri" : "notificari";
  const footer = { text: "Istoric pastrat ~30 zile (best-effort)" };
  if (!records.length) {
    return {
      title: `Istoric ${scopeLabel}`,
      description: "Nu exista notificari inregistrate pentru acest server inca.",
      color: 0x95a5a6,
      footer
    };
  }
  const lines = records.map(record => {
    const emoji = record.kind === "discount" ? "💸" : "🎮";
    const timestamp = Math.floor(record.sentAt.getTime() / 1000);
    const label = truncateLabel(record.title || record.gameKey || "(fara titlu)", 120);
    const text = record.link ? `[${label}](${escapeMarkdownLinkUrl(record.link)})` : label;
    return `${emoji} ${text} — <t:${timestamp}:R>`;
  });
  return {
    title: `Istoric ${scopeLabel} (ultimele ${records.length})`,
    description: lines.join("\n").slice(0, 4000),
    color: 0x3498db,
    footer
  };
}

function createHistoryInteractionHandler(deps: HistoryHandlerDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, getNotificationHistory, MessageFlags } = deps;

  async function handleHistoryInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) {
      return interaction.reply({ content: "Eroare: comanda /history merge doar pe un server.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "history"))) return undefined;
    const tip = interaction.options.getString("tip");
    const kind = mapHistoryKind(tip);
    const limit = interaction.options.getInteger?.("numar") ?? 10;
    const endLog = startCommandLog(interaction, "history", { kind, limit });
    await safeDefer(interaction, true);
    const records = await getNotificationHistory(guildId, kind, limit);
    const embed = buildHistoryEmbed(records, kind);
    endLog("ok", { count: records.length });
    return safeEdit(interaction, { embeds: [embed] });
  }

  return { handleHistoryInteraction };
}

function isHistoryCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "history";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return {
    content: "Eroare: Eroare neasteptata la procesarea comenzii.",
    flags: MessageFlags.Ephemeral
  };
}

type HistoryInstaller = ((target: HistoryContext) => void) & {
  createHistoryInteractionHandler: typeof createHistoryInteractionHandler;
  buildHistoryEmbed: typeof buildHistoryEmbed;
  mapHistoryKind: typeof mapHistoryKind;
};

const installHistoryInteraction = ((target: HistoryContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const handlers = createHistoryInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getNotificationHistory: target.getNotificationHistory,
    MessageFlags: target.MessageFlags
  });

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isHistoryCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    try {
      return await handlers.handleHistoryInteraction(interaction);
    } catch (err: unknown) {
      target.logger?.("ERROR", "HISTORY_INTERACTION", "Eroare in handler-ul /history", errorDetail(err));
      const payload = createInteractionErrorPayload(target.MessageFlags);
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {  }
      return undefined;
    }
  }

  Object.assign(target, handlers, { handleInteraction });
}) as HistoryInstaller;

installHistoryInteraction.createHistoryInteractionHandler = createHistoryInteractionHandler;
installHistoryInteraction.buildHistoryEmbed = buildHistoryEmbed;
installHistoryInteraction.mapHistoryKind = mapHistoryKind;

export = installHistoryInteraction;
