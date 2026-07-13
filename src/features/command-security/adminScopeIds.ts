import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
"use strict";

import { COMMAND_HELP_ENTRIES } from "../command-help/commandHelpCatalog.js";
import { canonicalAdminCommandAccessScope } from "./adminCommandAccessScope.js";

type ScopeProbeInteraction = {
  isChatInputCommand: () => boolean;
  commandName: string;
  guild: { id: string };
  options: {
    getSubcommand: (required?: boolean) => string;
    getSubcommandGroup: (required?: boolean) => string | null;
  };
};

const adminCommandRouterGuard = require("./adminCommandRouterGuard").default as {
  isAdminProtectedCommand: (interaction: ScopeProbeInteraction) => boolean;
  isOwnerOnlyAdminAccessCommand: (interaction: ScopeProbeInteraction) => boolean;
};

declare const adminScopeIdBrand: unique symbol;
export type AdminScopeId = string & { readonly [adminScopeIdBrand]: true };

export const GLOBAL_ADMIN_SCOPE_ID = "global" as AdminScopeId;

function probeInteractionFromPath(commandPath: string): ScopeProbeInteraction {
  const tokens = commandPath.replace(/^\/+/, "").trim().split(/\s+/).filter(Boolean);
  const grouped = tokens.length >= 3;
  return {
    isChatInputCommand: () => true,
    commandName: tokens[0] || "",
    guild: { id: "scope-catalog" },
    options: {
      getSubcommand: () => grouped ? tokens[2] || "" : tokens[1] || "",
      getSubcommandGroup: () => grouped ? tokens[1] || null : null
    }
  };
}

export function isSettableAdminCommandPath(commandPath: string): boolean {
  const probe = probeInteractionFromPath(commandPath);
  return adminCommandRouterGuard.isAdminProtectedCommand(probe)
    && !adminCommandRouterGuard.isOwnerOnlyAdminAccessCommand(probe);
}

export function listSettableAdminScopePaths(): string[] {
  return COMMAND_HELP_ENTRIES
    .filter(entry => isSettableAdminCommandPath(entry.command))
    .map(entry => entry.command);
}

const ADMIN_SCOPE_ID_SET: ReadonlySet<string> = new Set<string>([
  GLOBAL_ADMIN_SCOPE_ID,
  ...listSettableAdminScopePaths().map(path => canonicalAdminCommandAccessScope(path))
]);

export const ADMIN_SCOPE_IDS: readonly AdminScopeId[] = Object.freeze(
  Array.from(ADMIN_SCOPE_ID_SET).sort()
) as readonly AdminScopeId[];

export function parseAdminScopeId(value: string | null | undefined): AdminScopeId | null {
  const canonical = canonicalAdminCommandAccessScope(String(value ?? ""));
  return ADMIN_SCOPE_ID_SET.has(canonical) ? canonical as AdminScopeId : null;
}

export function isAdminScopeId(value: string): value is AdminScopeId {
  return ADMIN_SCOPE_ID_SET.has(value);
}
