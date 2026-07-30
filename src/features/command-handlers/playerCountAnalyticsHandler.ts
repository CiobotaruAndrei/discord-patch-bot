"use strict";

import type {
  ChatInputInteraction,
  StringOption,
  SubcommandOption
} from "./discordInteractionPorts.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { GuildSettings } from "../guild-config/guildSettingsTypes.js";
import type { PlayerCountHistoryPoint, PlayerCountRecord, PlayerCountSnapshot } from "../player-count/playerCountSnapshotService.js";
import {
  calculatePlayerCountStats,
  playerCountDirectionLabel,
  type PlayerCountStats
} from "../player-count/playerCountTimeAnalysis.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { errorDetail } from "../../shared/errors.js";

type Period = "24h" | "7d" | "30d";

type DiscordInteraction = ChatInputInteraction<SubcommandOption & StringOption>;

interface PlayerCountAnalyticsDeps {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  findGameAndSuggestion(query: string, games: GameConfig[]): { game: GameConfig | null; suggestion: GameConfig | null };
  readPlayerCountHistory(appIds: readonly (string | number)[], since: Date): Promise<PlayerCountHistoryPoint[]>;
  readPlayerCountRecords(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountRecord>>;
  readPlayerCountSnapshots(appIds: readonly (string | number)[]): Promise<Map<string, PlayerCountSnapshot>>;
  fetchSteamCurrentPlayers(appId: string | number): Promise<{ playerCount: number; success: boolean }>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  MessageFlags: { Ephemeral: number };
}

export { calculatePlayerCountStats } from "../player-count/playerCountTimeAnalysis.js";

function directionLabel(direction: PlayerCountStats["direction"]): string {
  return playerCountDirectionLabel(direction);
}

export function buildSparkline(values: readonly number[], width = 30): string {
  if (!values.length) return "";
  const sampled = values.length <= width
    ? [...values]
    : Array.from({ length: width }, (_, index) => values[Math.min(values.length - 1, Math.floor(index * values.length / width))]);
  const minimum = Math.min(...sampled);
  const maximum = Math.max(...sampled);
  const blocks = "▁▂▃▄▅▆▇█";
  if (minimum === maximum) return sampled.map(() => blocks[3]).join("");
  return sampled.map(value => blocks[Math.min(blocks.length - 1, Math.floor((value - minimum) * blocks.length / (maximum - minimum + 1)))]).join("");
}

function periodMs(period: string | null): number {
  if (period === "24h") return 24 * 60 * 60_000;
  if (period === "7d") return 7 * 24 * 60 * 60_000;
  return 30 * 24 * 60 * 60_000;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function resolveGame(interaction: DiscordInteraction, games: GameConfig[], deps: PlayerCountAnalyticsDeps): { game: GameConfig | null; query: string; error: string | null } {
  const query = String(interaction.options.getString("joc", true) || "").trim();
  if (!query) return { game: null, query, error: "Eroare: trebuie sa specifici jocul." };
  const { game, suggestion } = deps.findGameAndSuggestion(query, games);
  if (!game) return { game: null, query, error: suggestion ? `Nu am gasit jocul. Te refereai la **${suggestion.name}**?` : "Nu am gasit jocul." };
  if (!game.appId) return { game: null, query, error: `**${game.name}** nu are Steam appId configurat.` };
  return { game, query, error: null };
}

function timeZoneOrUtc(value: unknown): string {
  const timezone = String(value || "UTC");
  try {
    new Intl.DateTimeFormat("ro-RO", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function createPlayerCountAnalyticsHandler(deps: PlayerCountAnalyticsDeps) {
  async function trend(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const resolved = resolveGame(interaction, games, deps);
    if (!resolved.game) return deps.safeEdit(interaction, resolved.error);
    const period = String(interaction.options.getString("period", true) || "24h") as Period;
    const to = new Date();
    const from = new Date(to.getTime() - periodMs(period));
    const points = await deps.readPlayerCountHistory([String(resolved.game.appId)], from);
    const stats = calculatePlayerCountStats(points, { from, to });
    if (!stats) return deps.safeEdit(interaction, `Nu exista suficiente date pentru **${resolved.game.name}** in perioada ${period}.`);
    return deps.safeEdit(interaction, {
      embeds: [{
        title: `Trend player-count: ${resolved.game.name}`,
        color: 0x5865f2,
        description: `Perioada: **${period}**\n\`${buildSparkline(points.map(point => point.playerCount))}\``,
        fields: [
          { name: "Minim", value: formatCount(stats.minimum), inline: true },
          { name: `Varf (peak ${period})`, value: `${formatCount(stats.maximum)} — atins <t:${Math.floor(stats.peakAt.getTime() / 1000)}:R>`, inline: true },
          { name: "Medie", value: formatCount(stats.average), inline: true },
          { name: "Cea mai recenta", value: formatCount(stats.latest), inline: true },
          { name: "Tendinta", value: directionLabel(stats.direction), inline: true }
        ]
      }]
    });
  }

  async function milestone(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const resolved = resolveGame(interaction, games, deps);
    if (!resolved.game) return deps.safeEdit(interaction, resolved.error);
    const appId = String(resolved.game.appId);
    const [records, snapshots] = await Promise.all([
      deps.readPlayerCountRecords([appId]),
      deps.readPlayerCountSnapshots([appId])
    ]);
    const record = records.get(appId);
    if (!record) return deps.safeEdit(interaction, `Nu exista inca un record istoric pentru **${resolved.game.name}**.`);
    let current = snapshots.get(appId)?.playerCount;
    if (current === undefined) {
      const live = await deps.fetchSteamCurrentPlayers(appId);
      if (live.success) current = live.playerCount;
    }
    const difference = current === undefined ? null : current - record.playerCount;
    return deps.safeEdit(interaction, {
      embeds: [{
        title: `Milestone player-count: ${resolved.game.name}`,
        color: 0xf1c40f,
        description: `Record istoric: **${formatCount(record.playerCount)}**\nAtins la: <t:${Math.floor(record.reachedAt.getTime() / 1000)}:F>\nCurent: **${current === undefined ? "indisponibil" : formatCount(current)}**\nDiferenta fata de record: **${difference === null ? "indisponibila" : formatCount(difference)}**`
      }]
    });
  }

  async function gainers(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const period = String(interaction.options.getString("period", true) || "24h") as Period;
    const candidates = games.filter(game => Boolean(game.appId));
    const points = await deps.readPlayerCountHistory(candidates.map(game => String(game.appId)), new Date(Date.now() - periodMs(period)));
    const byAppId = new Map<string, PlayerCountHistoryPoint[]>();
    for (const point of points) byAppId.set(point.appId, [...(byAppId.get(point.appId) || []), point]);
    const rows = candidates.flatMap(game => {
      const series = byAppId.get(String(game.appId)) || [];
      if (series.length < 2) return [];
      const start = series[0].playerCount;
      const current = series.at(-1)?.playerCount ?? start;
      const gain = current - start;
      const percent = start > 0 ? gain / start * 100 : gain > 0 ? 100 : 0;
      return [{ game, start, current, gain, percent }];
    }).filter(row => row.gain > 0).sort((left, right) => right.gain - left.gain);
    if (!rows.length) return deps.safeEdit(interaction, `Nu exista suficiente date sau cresteri pozitive pentru perioada ${period}.`);
    return deps.safeEdit(interaction, {
      embeds: [{
        title: `Player-count gainers (${period})`,
        color: 0x2ecc71,
        description: rows.slice(0, 20).map((row, index) => `${index + 1}. **${row.game.name}**: ${formatCount(row.start)} → ${formatCount(row.current)} | **+${formatCount(row.gain)}** (${row.percent.toFixed(1)}%)`).join("\n")
      }]
    });
  }

  async function peakTime(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const resolved = resolveGame(interaction, games, deps);
    if (!resolved.game) return deps.safeEdit(interaction, resolved.error);
    const period = String(interaction.options.getString("period", true) || "7d") as Period;
    const points = await deps.readPlayerCountHistory([String(resolved.game.appId)], new Date(Date.now() - periodMs(period)));
    if (points.length < 6) return deps.safeEdit(interaction, `Nu exista suficiente date pentru intervalele de varf ale jocului **${resolved.game.name}**.`);
    const settings = interaction.guild?.id ? await deps.getGuildSettings(interaction.guild.id) : null;
    const timezone = timeZoneOrUtc(settings?.timezone);
    const formatter = new Intl.DateTimeFormat("ro-RO", { timeZone: timezone, weekday: "long", hour: "2-digit", hour12: false });
    const buckets = new Map<string, { total: number; count: number; peak: number }>();
    for (const point of points) {
      const parts = formatter.formatToParts(point.fetchedAt);
      const day = parts.find(part => part.type === "weekday")?.value || "necunoscut";
      const hour = parts.find(part => part.type === "hour")?.value || "00";
      const key = `${day}, ${hour}:00-${String((Number(hour) + 1) % 24).padStart(2, "0")}:00`;
      const current = buckets.get(key) || { total: 0, count: 0, peak: 0 };
      current.total += point.playerCount;
      current.count += 1;
      current.peak = Math.max(current.peak, point.playerCount);
      buckets.set(key, current);
    }
    const ranked = Array.from(buckets, ([label, bucket]) => ({ label, average: Math.round(bucket.total / bucket.count), peak: bucket.peak, samples: bucket.count }))
      .filter(item => item.samples >= 1)
      .sort((left, right) => right.average - left.average);
    const best = ranked[0];
    if (!best) return deps.safeEdit(interaction, "Nu exista suficiente date pentru calcul.");
    return deps.safeEdit(interaction, {
      embeds: [{
        title: `Peak time: ${resolved.game.name}`,
        color: 0x9b59b6,
        description: `Fus orar: **${timezone}**\nCel mai bun interval: **${best.label}**\nMedia: **${formatCount(best.average)}**\nRecord observat: **${formatCount(best.peak)}**`,
        fields: [{ name: "Urmatoarele intervale", value: ranked.slice(1, 6).map(item => `${item.label}: ${formatCount(item.average)} medie`).join("\n") || "Indisponibil" }]
      }]
    });
  }

  async function handle(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    if (!(await deps.enforceCooldown(interaction, "player-count analytics"))) return undefined;
    await deps.safeDefer(interaction);
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "trend") return trend(interaction, games);
    if (subcommand === "milestone") return milestone(interaction, games);
    if (subcommand === "gainers") return gainers(interaction, games);
    return peakTime(interaction, games);
  }

  return { handle };
}

function isAnalyticsCommand(interaction: DiscordInteraction): boolean {
  if (!matchesCommand(interaction, { commandNames: ["player-count"] })) return false;
  const subcommand = interaction.options.getSubcommand(false);
  return ["trend", "milestone", "gainers", "peak-time"].includes(subcommand);
}

function buildPlayerCountAnalyticsHandler(target: PlayerCountAnalyticsDeps) {
  const analytics = createPlayerCountAnalyticsHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isAnalyticsCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      try {
        return await analytics.handle(interaction, games as GameConfig[]);
      } catch (error: unknown) {
        target.logger("ERROR", "PLAYER_COUNT_ANALYTICS", "Eroare la analiza player-count", errorDetail(error));
        const payload = { content: "Eroare: analiza player-count nu este disponibila acum.", flags: target.MessageFlags.Ephemeral };
        if ((interaction.deferred || interaction.replied) && interaction.followUp) return interaction.followUp(payload);
        return interaction.reply?.(payload);
      }
    }
  };
  return { analytics, ...command };
}

export default { createPlayerCountAnalyticsHandler, buildCommandHandler: buildPlayerCountAnalyticsHandler };
