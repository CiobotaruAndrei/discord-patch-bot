"use strict";

import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";

import { errorDetail } from "../../shared/errors.js";

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

type HistoryKind = "update" | "discount" | "youtube";

const HISTORY_DESCRIPTION_MAX_CHARS = 4000;

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

type HistoryContext = HistoryHandlerDeps;

function mapHistoryKind(tip: string | null): HistoryKind | "all" {
  if (tip === "updates") return "update";
  if (tip === "reduceri") return "discount";
  if (tip === "youtube") return "youtube";
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
  const scopeLabel = kind === "update" ? "update-uri" : kind === "discount" ? "reduceri" : kind === "youtube" ? "YouTube" : "notificari";
  const footer = { text: "Istoric pastrat ~30 zile (best-effort)" };
  if (!records.length) {
    return {
      title: `Istoric ${scopeLabel}`,
      description: "Nu exista notificari inregistrate pentru acest server inca.",
      color: 0x95a5a6,
      footer
    };
  }
  const lines: string[] = [];
  let totalChars = 0;
  for (const record of records) {
    const emoji = record.kind === "discount" ? "💸" : record.kind === "youtube" ? "📺" : "🎮";
    const timestamp = Math.floor(record.sentAt.getTime() / 1000);
    const label = truncateLabel(record.title || record.gameKey || "(fara titlu)", 120);
    const text = record.link ? `[${label}](${escapeMarkdownLinkUrl(record.link)})` : label;
    const line = `${emoji} ${text} — <t:${timestamp}:R>`;
    const cost = (lines.length ? 1 : 0) + line.length;
    if (totalChars + cost > HISTORY_DESCRIPTION_MAX_CHARS) break;
    lines.push(line);
    totalChars += cost;
  }
  if (!lines.length) lines.push(`🎮 ${truncateLabel(records[0].title || records[0].gameKey || "(fara titlu)", 120)}`);
  return {
    title: `Istoric ${scopeLabel} (ultimele ${lines.length})`,
    description: lines.join("\n"),
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
  return matchesCommand(interaction, { commandNames: ["history"] });
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
  buildCommandHandler: typeof buildHistoryCommandHandler;
};

function buildHistoryCommandHandler(target: HistoryContext) {
  const handlers = createHistoryInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getNotificationHistory: target.getNotificationHistory,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isHistoryCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleHistoryInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "HISTORY_INTERACTION", "Eroare in handler-ul /history", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default {
  buildCommandHandler: buildHistoryCommandHandler,
  createHistoryInteractionHandler,
  buildHistoryEmbed,
  mapHistoryKind
};
