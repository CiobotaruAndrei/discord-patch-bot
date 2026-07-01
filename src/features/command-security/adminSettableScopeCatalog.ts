"use strict";

import { COMMAND_HELP_ENTRIES } from "../command-help/commandHelpCatalog";
import { normalizeAdminCommandAccessScope } from "./adminCommandAccessScope";

type ScopeProbeInteraction = {
  isChatInputCommand: () => boolean;
  commandName: string;
  guild: { id: string };
  options: {
    getSubcommand: (required?: boolean) => string;
    getSubcommandGroup: (required?: boolean) => string | null;
  };
};

const adminCommandRouterGuard = require("./adminCommandRouterGuard") as {
  isAdminProtectedCommand: (interaction: ScopeProbeInteraction) => boolean;
  isOwnerOnlyAdminAccessCommand: (interaction: ScopeProbeInteraction) => boolean;
};

type AdminScopeChoice = { name: string; value: string };

const GLOBAL_SCOPE = "global";
const MAX_SCOPE_CHOICES = 25;
const MAX_CHOICE_NAME_LEN = 100;

function probeInteractionFromPath(commandPath: string): ScopeProbeInteraction {
  const tokens = commandPath.replace(/^\/+/, "").trim().split(/\s+/).filter(Boolean);
  return {
    isChatInputCommand: () => true,
    commandName: tokens[0] || "",
    guild: { id: "scope-catalog" },
    options: {
      getSubcommand: () => tokens[1] || "",
      getSubcommandGroup: () => null
    }
  };
}

function isSettableAdminCommandPath(commandPath: string): boolean {
  const probe = probeInteractionFromPath(commandPath);
  return adminCommandRouterGuard.isAdminProtectedCommand(probe)
    && !adminCommandRouterGuard.isOwnerOnlyAdminAccessCommand(probe);
}

export function listSettableAdminScopePaths(): string[] {
  return COMMAND_HELP_ENTRIES
    .filter(entry => isSettableAdminCommandPath(entry.command))
    .map(entry => entry.command);
}

const SETTABLE_SCOPE_KEYS = new Set(listSettableAdminScopePaths().map(normalizeAdminCommandAccessScope));

export function isSettableAdminScope(scope: string): boolean {
  const normalized = normalizeAdminCommandAccessScope(scope);
  return normalized === GLOBAL_SCOPE || SETTABLE_SCOPE_KEYS.has(normalized);
}

function scoreCommandPath(commandPath: string, input: string): number {
  if (!input) return 0;
  const key = commandPath.replace(/^\/+/, "").toLowerCase();
  if (key === input) return 100;
  if (key.startsWith(input)) return 60;
  if (key.includes(input)) return 30;
  return -1;
}

export function buildSettableAdminScopeChoices(inputValue: unknown): AdminScopeChoice[] {
  const input = String(inputValue ?? "").replace(/^\/+/, "").trim().toLowerCase().slice(0, 100);
  const matched = COMMAND_HELP_ENTRIES
    .filter(entry => isSettableAdminCommandPath(entry.command))
    .map((entry, index) => ({ entry, index, score: scoreCommandPath(entry.command, input) }))
    .filter(item => item.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ entry }) => ({
      name: `${entry.command} (${entry.permissions})`.slice(0, MAX_CHOICE_NAME_LEN),
      value: entry.command
    }));
  const includeGlobal = !input || GLOBAL_SCOPE.includes(input) || "toate".includes(input);
  const head = includeGlobal ? [{ name: "global (toate comenzile admin)", value: GLOBAL_SCOPE }] : [];
  return [...head, ...matched].slice(0, MAX_SCOPE_CHOICES);
}
