"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";
import type { GameConfig } from "../../types";

import { handledCommandError } from "../command-security/commandOutcome";
const { errorDetail } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
  options: { getSubcommand: () => string };
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;
type InteractionPayload = string | { content?: string; embeds?: SourcesStatusEmbed[]; flags?: number };

interface LoadedFetchSnapshot {
  payload: unknown;
  fetchedAt: Date;
}

interface LoadedDealsFetchSnapshot extends LoadedFetchSnapshot {
  currency: string;
}

interface SourcesStatusEmbed {
  title: string;
  description: string;
  color: number;
  footer: { text: string };
}

interface SourceStatusLine {
  label: string;
  state: "OK" | "eroare" | "fara date";
  detail: string;
}

interface SourcesStatusDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: InteractionPayload) => Promise<unknown>;
  loadFetchSnapshot: (id: string) => Promise<LoadedFetchSnapshot | null>;
  loadDealsFetchSnapshots: () => Promise<LoadedDealsFetchSnapshot[]>;
  MessageFlags: { Ephemeral: number };
}

type SourcesStatusContext = SourcesStatusDeps & { handleInteraction?: NextInteractionHandler };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function findUpdateEntry(payload: unknown, gameKey: string): Record<string, unknown> | null {
  if (!Array.isArray(payload)) return null;
  const lowerKey = gameKey.toLowerCase();
  for (const item of payload) {
    if (!isRecord(item) || !isRecord(item.game)) continue;
    if (String(item.game.key || "").toLowerCase() === lowerKey) return item;
  }
  return null;
}

function lineForUpdateGame(game: GameConfig, snapshot: LoadedFetchSnapshot | null): SourceStatusLine {
  if (!snapshot) return { label: `Update feed ${game.name}`, state: "fara date", detail: "nu exista snapshot" };
  const entry = findUpdateEntry(snapshot.payload, game.key);
  if (!entry) return { label: `Update feed ${game.name}`, state: "fara date", detail: "lipseste din snapshot" };
  const error = typeof entry.error === "string" ? entry.error : "";
  if (error && error !== "abort") return { label: `Update feed ${game.name}`, state: "eroare", detail: error.slice(0, 80) };
  return entry.latest ? { label: `Update feed ${game.name}`, state: "OK", detail: "" }
    : { label: `Update feed ${game.name}`, state: "fara date", detail: "fara update valid" };
}

function storeFoundInDeals(payload: unknown, storeNeedle: string): boolean {
  if (!Array.isArray(payload)) return false;
  const needle = storeNeedle.toLowerCase();
  return payload.some(item => {
    if (!isRecord(item)) return false;
    return String(item.store || item.source || "").toLowerCase().includes(needle);
  });
}

function lineForDealStore(label: string, storeNeedle: string, snapshots: LoadedDealsFetchSnapshot[]): SourceStatusLine {
  if (!snapshots.length) return { label, state: "fara date", detail: "nu exista snapshot deals" };
  const found = snapshots.some(snapshot => storeFoundInDeals(snapshot.payload, storeNeedle));
  return found ? { label, state: "OK", detail: "" } : { label, state: "fara date", detail: "nu apare in snapshot" };
}

function formatAge(nowMs: number, date: Date): string {
  const minutes = Math.max(0, Math.round((nowMs - date.getTime()) / 60000));
  if (minutes < 1) return "acum sub 1 minut";
  if (minutes === 1) return "acum 1 minut";
  return `acum ${minutes} minute`;
}

function newestFetchDate(updates: LoadedFetchSnapshot | null, deals: LoadedDealsFetchSnapshot[]): Date | null {
  const dates = [updates?.fetchedAt, ...deals.map(snapshot => snapshot.fetchedAt)]
    .filter((date): date is Date => date instanceof Date && Number.isFinite(date.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(date => date.getTime())));
}

function renderLine(line: SourceStatusLine): string {
  const suffix = line.detail ? ` (${line.detail})` : "";
  return `${line.label}: ${line.state}${suffix}`;
}

function buildSourcesStatusEmbed(
  games: GameConfig[],
  updatesSnapshot: LoadedFetchSnapshot | null,
  dealSnapshots: LoadedDealsFetchSnapshot[],
  now = new Date()
): SourcesStatusEmbed {
  const lines: SourceStatusLine[] = [
    lineForDealStore("Steam", "steam", dealSnapshots),
    lineForDealStore("Epic", "epic", dealSnapshots),
    ...games.map(game => lineForUpdateGame(game, updatesSnapshot))
  ];
  const visible = lines.slice(0, 22).map(renderLine);
  if (lines.length > visible.length) visible.push(`... inca ${lines.length - visible.length} surse in snapshot`);
  const newest = newestFetchDate(updatesSnapshot, dealSnapshots);
  const failures = lines.filter(line => line.state === "eroare").length;
  const missing = lines.filter(line => line.state === "fara date").length;
  const color = failures > 0 ? 0xe67e22 : missing > 0 ? 0xf1c40f : 0x2ecc71;
  const lastFetch = newest ? formatAge(now.getTime(), newest) : "nu exista snapshot";

  return {
    title: "Status surse",
    description: `${visible.join("\n")}\n\nUltimul fetch: ${lastFetch}`,
    color,
    footer: { text: "Status calculat din snapshot-urile persistate ale ultimelor fetch-uri." }
  };
}

function createSourcesStatusHandler(deps: SourcesStatusDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, loadFetchSnapshot, loadDealsFetchSnapshots } = deps;

  async function handleSourcesStatus(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    if (!(await enforceCooldown(interaction, "sources"))) return undefined;
    const endLog = startCommandLog(interaction, "sources:status");
    await safeDefer(interaction, true);
    const [updatesSnapshot, dealSnapshots] = await Promise.all([
      loadFetchSnapshot("updates"),
      loadDealsFetchSnapshots()
    ]);
    const embed = buildSourcesStatusEmbed(games, updatesSnapshot, dealSnapshots);
    endLog("ok", { dealSnapshots: dealSnapshots.length });
    return safeEdit(interaction, { embeds: [embed] });
  }

  return { handleSourcesStatus };
}

function isSourcesStatusCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true) return false;
  if (!interaction.guild) return false;
  if (interaction.commandName !== "sources") return false;
  return interaction.options.getSubcommand() === "status";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }): InteractionPayload {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

type SourcesStatusInstaller = ((target: SourcesStatusContext) => void) & {
  createSourcesStatusHandler: typeof createSourcesStatusHandler;
  buildSourcesStatusEmbed: typeof buildSourcesStatusEmbed;
  buildCommandHandler: typeof buildSourcesStatusCommandHandler;
};

function buildSourcesStatusCommandHandler(target: SourcesStatusContext) {
  const handlers = createSourcesStatusHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    loadFetchSnapshot: target.loadFetchSnapshot,
    loadDealsFetchSnapshots: target.loadDealsFetchSnapshots,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isSourcesStatusCommand(interaction as DiscordInteraction),
    handle: async (interaction, games) => {
      const di = interaction;
      try {
        return await handlers.handleSourcesStatus(di, games);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SOURCES_STATUS", "Eroare in handler-ul /sources status", errorDetail(err));
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

const installSourcesStatus = ((target: SourcesStatusContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildSourcesStatusCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}) as SourcesStatusInstaller;

installSourcesStatus.buildCommandHandler = buildSourcesStatusCommandHandler;
installSourcesStatus.createSourcesStatusHandler = createSourcesStatusHandler;
installSourcesStatus.buildSourcesStatusEmbed = buildSourcesStatusEmbed;

export = installSourcesStatus;
