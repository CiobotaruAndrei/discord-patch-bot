"use strict";

export type CommandSnoozeValue = Date | string | number;
export type CommandSnoozeStore = Map<string, CommandSnoozeValue> | Record<string, CommandSnoozeValue>;

export type CommandPathInteraction = {
  commandName?: string;
  options?: {
    getSubcommandGroup?(required: false): string | null;
    getSubcommand?(required?: false): string | null;
  };
};

export type SnoozeDurationParse =
  | { ok: true; until: Date; seconds: number }
  | { ok: false; message: string };

const CONTROL_COMMANDS = new Set(["snooze", "unsnooze"]);
const MAX_SNOOZE_SECONDS = 30 * 24 * 60 * 60;
const MIN_SNOOZE_SECONDS = 60;

export function normalizeCommandPath(value: string): string {
  return value.trim().replace(/^\/+/, "").replace(/\s+/g, " ").toLowerCase();
}

export function displayCommandPath(value: string): string {
  const normalized = normalizeCommandPath(value);
  return normalized ? `/${normalized}` : "";
}

export function commandPathToSnoozeKey(value: string): string {
  return normalizeCommandPath(value)
    .replace(/[^a-z0-9-]+/g, "__")
    .replace(/^_+|_+$/g, "");
}

export function commandCanBeSnoozed(value: string): boolean {
  const normalized = normalizeCommandPath(value);
  if (!normalized) return false;
  const topLevel = normalized.split(" ")[0];
  return !CONTROL_COMMANDS.has(topLevel);
}

export function parseSnoozeDuration(raw: string, nowMs = Date.now()): SnoozeDurationParse {
  const match = raw.trim().toLowerCase().match(/^(\d+)\s*(m|min|minute|h|hour|ore|d|day|zi|zile)$/);
  if (!match) {
    return { ok: false, message: "Durata trebuie sa fie de forma `30m`, `2h` sau `1d`." };
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" || unit === "min" || unit === "minute"
    ? 60
    : unit === "h" || unit === "hour" || unit === "ore"
      ? 60 * 60
      : 24 * 60 * 60;
  const seconds = amount * multiplier;
  if (!Number.isFinite(seconds) || seconds < MIN_SNOOZE_SECONDS) {
    return { ok: false, message: "Durata minima este `1m`." };
  }
  if (seconds > MAX_SNOOZE_SECONDS) {
    return { ok: false, message: "Durata maxima este `30d`." };
  }
  return { ok: true, seconds, until: new Date(nowMs + seconds * 1000) };
}

function readSnoozeValue(store: CommandSnoozeStore | null | undefined, key: string): CommandSnoozeValue | undefined {
  if (!store) return undefined;
  if (store instanceof Map) return store.get(key);
  return store[key];
}

function toValidDate(value: CommandSnoozeValue | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function readCommandSnoozeUntil(store: CommandSnoozeStore | null | undefined, commandPath: string): Date | null {
  const normalized = normalizeCommandPath(commandPath);
  if (!normalized) return null;
  const exact = toValidDate(readSnoozeValue(store, commandPathToSnoozeKey(normalized)));
  const topLevel = normalized.split(" ")[0];
  const command = toValidDate(readSnoozeValue(store, commandPathToSnoozeKey(topLevel)));
  const candidates = [exact, command].filter((date): date is Date => Boolean(date));
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, date) => date.getTime() > latest.getTime() ? date : latest);
}

export function buildInteractionCommandPath(interaction: CommandPathInteraction): string {
  const commandName = normalizeCommandPath(interaction.commandName || "");
  if (!commandName) return "";
  const parts = [commandName];
  try {
    const group = interaction.options?.getSubcommandGroup?.(false);
    if (group) parts.push(group);
  } catch {
  }
  try {
    const subcommand = interaction.options?.getSubcommand?.(false);
    if (subcommand) parts.push(subcommand);
  } catch {
  }
  return normalizeCommandPath(parts.join(" "));
}
