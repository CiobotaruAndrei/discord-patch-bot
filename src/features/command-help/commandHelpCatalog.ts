"use strict";

import { COMMAND_CATALOG_HELP, permissionsLabelFor } from "../command-catalog/commandCatalog.js";

type AutocompleteChoice = { name: string; value: string };
type CommandHelpChoiceOptions = { excludeCommands?: readonly string[] };

export type CommandHelpEntry = {
  command: string;
  permissions: string;
  description: string;
  example: string;
  notes?: readonly string[];
  aliases?: readonly string[];
};

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LEN = 100;

export const COMMAND_HELP_ENTRIES: readonly CommandHelpEntry[] = COMMAND_CATALOG_HELP.map(entry => ({
  command: entry.command,
  permissions: permissionsLabelFor(entry.command, entry.ephemeral),
  description: entry.description,
  example: entry.example,
  ...(entry.notes ? { notes: entry.notes } : {}),
  ...(entry.aliases ? { aliases: entry.aliases } : {})
}));

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeCommandHelpQuery(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  return raw.trim().replace(/^\/+/, "").replace(/\s+/g, " ").toLowerCase();
}

function searchKeys(entry: CommandHelpEntry): string[] {
  return [entry.command, ...(entry.aliases || [])].map(normalizeCommandHelpQuery);
}

export function findCommandHelpEntry(value: unknown): CommandHelpEntry | null {
  const query = normalizeCommandHelpQuery(value);
  if (!query) return null;
  return COMMAND_HELP_ENTRIES.find(entry => searchKeys(entry).includes(query)) ?? null;
}

function scoreEntry(entry: CommandHelpEntry, input: string): number {
  if (!input) return 0;
  let score = -1;
  for (const key of searchKeys(entry)) {
    if (key === input) score = Math.max(score, 100);
    else if (key.startsWith(input)) score = Math.max(score, 60);
    else if (key.includes(input)) score = Math.max(score, 30);
  }
  return score;
}

export function buildCommandHelpChoices(inputValue: unknown, options: CommandHelpChoiceOptions = {}): AutocompleteChoice[] {
  const input = normalizeCommandHelpQuery(inputValue).slice(0, 100);
  const excluded = new Set((options.excludeCommands || []).map(normalizeCommandHelpQuery));
  return COMMAND_HELP_ENTRIES
    .filter(entry => !excluded.has(normalizeCommandHelpQuery(entry.command)))
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, input) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_AUTOCOMPLETE_CHOICES)
    .map(({ entry }) => ({
      name: truncateText(`${entry.command} (${entry.permissions})`, MAX_CHOICE_NAME_LEN),
      value: entry.command
    }));
}

export function renderCommandHelpEntry(entry: CommandHelpEntry): string {
  const lines = [
    entry.command,
    `Permisiuni: ${entry.permissions}`,
    `Ce face: ${entry.description}`,
    `Exemplu: ${entry.example}`
  ];
  for (const note of entry.notes || []) {
    lines.push(`Nota: ${note}`);
  }
  return lines.join("\n");
}
