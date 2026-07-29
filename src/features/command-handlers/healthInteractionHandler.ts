"use strict";

import type {
  AlwaysReplies,
  ChatInputInteraction,
  PartialInteractionGuildRef,
  StringOption
} from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import type { RedisStatus } from "../../infra/redis/redisClient.js";

import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail } from "../../shared/errors.js";

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;

type DiscordInteraction = ChatInputInteraction<StringOption, PartialInteractionGuildRef> & AlwaysReplies & {
  client?: { isReady?: () => boolean; ws?: { ping?: number } } | null;
};

type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

interface CacheSizesLike { single: number; dlc: number }

interface HealthSnapshot {
  discordReady: boolean;
  discordPing: number;
  mongoReadyState: number;
  redisStatus: RedisStatus;
  cacheSizes: CacheSizesLike;
  uptimeSeconds: number;
}

interface HealthHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown>;
  getCacheSizes: () => CacheSizesLike;
  getMongoReadyState: () => number;
  getRedisStatus: () => RedisStatus;
  MessageFlags: { Ephemeral: number };
}

type HealthContext = Omit<HealthHandlerDeps, "getMongoReadyState" | "getRedisStatus">;

const MONGO_STATE_LABELS: Record<number, string> = {
  0: "deconectat",
  1: "conectat",
  2: "se conecteaza",
  3: "se deconecteaza"
};

const REDIS_STATUS_LABELS: Record<RedisStatus, string> = {
  disabled: "⚪ dezactivat",
  connected: "🟢 conectat",
  disconnected: "🔴 deconectat"
};

function formatUptime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}z`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function buildHealthEmbed(snapshot: HealthSnapshot): { title: string; description: string; color: number; fields: Array<{ name: string; value: string; inline: boolean }>; footer: { text: string } } {
  const mongoOk = snapshot.mongoReadyState === 1;
  const ok = snapshot.discordReady && mongoOk;
  const discordLine = `Discord: ${snapshot.discordReady ? "🟢 conectat" : "🔴 neconectat"}${snapshot.discordPing >= 0 ? ` (ping ${snapshot.discordPing}ms)` : ""}`;
  const mongoLine = `MongoDB: ${mongoOk ? "🟢" : "🔴"} ${MONGO_STATE_LABELS[snapshot.mongoReadyState] || "necunoscut"}`;
  const redisLine = `Redis: ${REDIS_STATUS_LABELS[snapshot.redisStatus]}`;
  return {
    title: ok ? "Stare bot: OK 🟢" : "Stare bot: degradat 🟠",
    description: `${discordLine}\n${mongoLine}\n${redisLine}`,
    color: ok ? 0x2ecc71 : 0xe67e22,
    fields: [
      { name: "Uptime", value: formatUptime(snapshot.uptimeSeconds), inline: true },
      { name: "Cache", value: `single ${snapshot.cacheSizes.single} · dlc ${snapshot.cacheSizes.dlc}`, inline: true }
    ],
    footer: { text: "Metrici detaliate (surse, coada outbox, cron) la /metrics" }
  };
}

function createHealthInteractionHandler(deps: HealthHandlerDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, getCacheSizes, getMongoReadyState, getRedisStatus } = deps;

  async function handleHealthInteraction(interaction: DiscordInteraction): Promise<unknown> {
    if (!(await enforceCooldown(interaction, "health"))) return undefined;
    const endLog = startCommandLog(interaction, "health");
    await safeDefer(interaction, true);
    const snapshot: HealthSnapshot = {
      discordReady: interaction.client?.isReady?.() === true,
      discordPing: Number(interaction.client?.ws?.ping ?? -1),
      mongoReadyState: getMongoReadyState(),
      redisStatus: getRedisStatus(),
      cacheSizes: getCacheSizes(),
      uptimeSeconds: Math.floor(process.uptime())
    };
    endLog("ok");
    return safeEdit(interaction, { embeds: [buildHealthEmbed(snapshot)] });
  }

  return { handleHealthInteraction };
}

function isHealthCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["health"], requireGuild: false });
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

type HealthContextWithDb = HealthContext & {
  GuildModel?: { db?: { readyState?: number } };
  redis?: { status(): RedisStatus };
};

type HealthInstaller = ((target: HealthContext) => void) & {
  createHealthInteractionHandler: typeof createHealthInteractionHandler;
  buildHealthEmbed: typeof buildHealthEmbed;
  formatUptime: typeof formatUptime;
  buildCommandHandler: typeof buildHealthCommandHandler;
};

function buildHealthCommandHandler(target: HealthContextWithDb) {
  const getMongoReadyState = () => {
    try {
      return Number(target.GuildModel?.db?.readyState ?? 0);
    } catch {
      return 0;
    }
  };
  const getRedisStatus = (): RedisStatus => {
    try {
      return target.redis?.status() ?? "disabled";
    } catch {
      return "disabled";
    }
  };
  const handlers = createHealthInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    getCacheSizes: target.getCacheSizes,
    getMongoReadyState,
    getRedisStatus,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isHealthCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleHealthInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "HEALTH_INTERACTION", "Eroare in handler-ul /health", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default {
  buildCommandHandler: buildHealthCommandHandler,
  createHealthInteractionHandler,
  buildHealthEmbed,
  formatUptime
};
