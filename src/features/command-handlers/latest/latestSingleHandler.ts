"use strict";

import type { EmbeddableUpdate, NormalizedUpdate } from "../../../types";

import { errorMessage } from "../../../shared/errors";

type GameConfig = { key: string; name: string } & Record<string, unknown>;
type NotificationMode = "compact" | "detailed";

interface DiscordInteraction {
  guild?: { id: string } | null;
  options: { getString(name: string): string | null };
  reply: (payload: unknown) => Promise<unknown>;
}

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;
type CacheEntry<T> = { data: T; expiresAt: number };
type SingleCache = Map<string, CacheEntry<NormalizedUpdate | null>>;

interface GuildSettingsLite {
  notificationMode?: NotificationMode;
}

export interface LatestSingleHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown | null>;
  findGameAndSuggestion: (query: string, games: GameConfig[]) => { game: GameConfig | null; suggestion: GameConfig | null };
  executeFetchWithCircuitBreaker: (game: GameConfig) => Promise<{ latest?: NormalizedUpdate | null; error?: string | null }>;
  cache: { single: SingleCache };
  cacheGetLRU: <T>(map: Map<string, CacheEntry<T>>, key: string) => T | null;
  cacheSetLRU: <T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number, maxSize: number) => void;
  getSystemTimes: () => Promise<{ single?: number }>;
  saveSystemTime: (key: string, value: number) => Promise<unknown>;
  smoothTime: (estimate: number, actual: number) => number;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  buildUpdateEmbed: (gameName: string, latest: EmbeddableUpdate, mode: NotificationMode) => unknown;
  CACHE_TTL_MS: number;
  SINGLE_CACHE_MAX_SIZE: number;
  MessageFlags: { Ephemeral: number };
}

export function createLatestSingleHandler(deps: LatestSingleHandlerDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit,
    findGameAndSuggestion, executeFetchWithCircuitBreaker,
    cache, cacheGetLRU, cacheSetLRU, CACHE_TTL_MS, SINGLE_CACHE_MAX_SIZE,
    getSystemTimes, saveSystemTime, smoothTime,
    getGuildSettings, formatUserError, buildUpdateEmbed,
    MessageFlags
  } = deps;

  async function handleLatestSingle(interaction: DiscordInteraction, games: GameConfig[]) {
    const gameText = interaction.options.getString("joc");
    if (!gameText) {
      return interaction.reply({ content: "Eroare: Trebuie sa specifici un joc.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "latest update"))) return;
    const endLog = startCommandLog(interaction, "latest update", { query: gameText });
    await safeDefer(interaction);

    const estMs = (await getSystemTimes()).single || 2000;
    await safeEdit(interaction, `Se incarca: *Ma conectez... Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde**.*`);
    const startTime = Date.now();
    const { game, suggestion } = findGameAndSuggestion(gameText, games);
    if (!game) {
      endLog("not_found", { suggestion: suggestion?.key });
      let errText = "Eroare: Nu am gasit jocul.";
      if (suggestion) errText += ` Te refereai cumva la **${suggestion.name}** (\`${suggestion.key}\`)?`;
      return safeEdit(interaction, errText);
    }
    try {
      let latest = cacheGetLRU(cache.single, game.key);
      if (latest === null) {
        const res = await executeFetchWithCircuitBreaker(game);
        if (res.error) throw new Error(res.error);
        latest = res.latest ?? null;
        if (latest) cacheSetLRU(cache.single, game.key, latest, CACHE_TTL_MS, SINGLE_CACHE_MAX_SIZE);
        await saveSystemTime("single", smoothTime(estMs, Date.now() - startTime));
      }
      if (!latest) {
        endLog("no_data", { gameKey: game.key });
        return safeEdit(interaction, `Info: Nu am gasit niciun update pentru **${game.name}**.`);
      }
      const guildId = interaction.guild?.id;
      const guild = guildId ? await getGuildSettings(guildId) : null;
      endLog("ok", { gameKey: game.key });
      return safeEdit(interaction, {
        content: `OK: Update **${game.name}**:`,
        embeds: [buildUpdateEmbed(game.name, latest, guild?.notificationMode || "detailed")]
      });
    } catch (err: unknown) {
      endLog("error", { gameKey: game.key, errorMsg: errorMessage(err) });
      return safeEdit(interaction, formatUserError(err, "Nu am putut prelua acest update.", "ERR_LATEST_SINGLE"));
    }
  }

  return { handleLatestSingle };
}
