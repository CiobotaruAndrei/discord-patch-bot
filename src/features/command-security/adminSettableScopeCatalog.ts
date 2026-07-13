"use strict";

import { COMMAND_HELP_ENTRIES } from "../command-help/commandHelpCatalog.js";
import {
  GLOBAL_ADMIN_SCOPE_ID,
  isSettableAdminCommandPath,
  listSettableAdminScopePaths,
  parseAdminScopeId
} from "./adminScopeIds.js";

export { listSettableAdminScopePaths };

type AdminScopeChoice = { name: string; value: string };

const MAX_SCOPE_CHOICES = 25;
const MAX_CHOICE_NAME_LEN = 100;

export function isSettableAdminScope(scope: string): boolean {
  return parseAdminScopeId(scope) !== null;
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
  const includeGlobal = !input || GLOBAL_ADMIN_SCOPE_ID.includes(input) || "toate".includes(input);
  const head = includeGlobal ? [{ name: "global (toate comenzile admin)", value: GLOBAL_ADMIN_SCOPE_ID as string }] : [];
  return [...head, ...matched].slice(0, MAX_SCOPE_CHOICES);
}
