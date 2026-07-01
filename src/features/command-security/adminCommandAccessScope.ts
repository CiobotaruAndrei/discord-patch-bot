"use strict";

export type AdminRoleAccessMode = "role" | "role-or-higher";

export type AdminCommandAccessConfig = {
  mode?: AdminRoleAccessMode | null;
  roleId?: string | null;
  updatedBy?: string | null;
  updatedAt?: Date | string | null;
};

export type AdminCommandAccessByCommand =
  | Record<string, AdminCommandAccessConfig | null | undefined>
  | Map<string, AdminCommandAccessConfig | null | undefined>;

export type AdminCommandAccessDoc = {
  adminCommandAccess?: AdminCommandAccessConfig | null;
  adminCommandAccessByCommand?: AdminCommandAccessByCommand | null;
};

type CommandPathInteraction = {
  commandName?: string;
  options?: {
    getSubcommandGroup?: (required?: boolean) => string | null;
    getSubcommand?: (required?: boolean) => string | null;
  };
};

const GLOBAL_SCOPE = "global";

function readCommandPart(read?: (required?: boolean) => string | null): string {
  if (typeof read !== "function") return "";
  try {
    return read(false) || "";
  } catch {
    return "";
  }
}

export function normalizeAdminCommandAccessScope(value: string | null | undefined): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9:_\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "*" || cleaned === "all" || cleaned === GLOBAL_SCOPE) return GLOBAL_SCOPE;
  return cleaned.replace(/\s+/g, ":").slice(0, 100);
}

export function buildAdminCommandAccessScope(interaction: CommandPathInteraction): string {
  const parts = [
    interaction.commandName || "",
    readCommandPart(interaction.options?.getSubcommandGroup),
    readCommandPart(interaction.options?.getSubcommand)
  ].filter(Boolean);
  return normalizeAdminCommandAccessScope(parts.join(" "));
}

export function displayAdminCommandAccessScope(scope: string): string {
  const normalized = normalizeAdminCommandAccessScope(scope);
  return normalized === GLOBAL_SCOPE ? "toate comenzile admin" : `/${normalized.replace(/:/g, " ")}`;
}

function hasMapGetter(value: AdminCommandAccessByCommand): value is Map<string, AdminCommandAccessConfig | null | undefined> {
  return typeof value.get === "function";
}

export function readAdminCommandAccessForScope(
  scoped: AdminCommandAccessByCommand | null | undefined,
  scope: string
): AdminCommandAccessConfig | null {
  if (!scoped) return null;
  const key = normalizeAdminCommandAccessScope(scope);
  const value = hasMapGetter(scoped) ? scoped.get(key) : scoped[key];
  return value || null;
}

export function resolveAdminCommandAccessForScope(
  doc: AdminCommandAccessDoc | null | undefined,
  scope: string
): AdminCommandAccessConfig | null {
  return readAdminCommandAccessForScope(doc?.adminCommandAccessByCommand, scope) || doc?.adminCommandAccess || null;
}

export function listScopedAdminCommandAccess(scoped: AdminCommandAccessByCommand | null | undefined): Array<[string, AdminCommandAccessConfig]> {
  if (!scoped) return [];
  const entries = hasMapGetter(scoped)
    ? Array.from(scoped.entries())
    : Object.entries(scoped);
  return entries
    .filter((entry): entry is [string, AdminCommandAccessConfig] => Boolean(entry[1]?.roleId && entry[1]?.mode))
    .sort(([left], [right]) => left.localeCompare(right));
}
