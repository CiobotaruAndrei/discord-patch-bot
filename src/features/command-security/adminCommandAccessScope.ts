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
const START_STOP_SCOPE = "start-stop";

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
  const parts = cleaned.split(" ").filter(Boolean);
  if ((parts[0] === "start" || parts[0] === "stop") && parts.length > 1) {
    parts[0] = START_STOP_SCOPE;
  }
  return parts.join(":").slice(0, 100);
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
  if (normalized === GLOBAL_SCOPE) return "toate comenzile admin";
  const parts = normalized.split(":");
  if (parts[0] === START_STOP_SCOPE && parts.length > 1) return `/start sau /stop ${parts.slice(1).join(" ")}`;
  return `/${parts.join(" ")}`;
}

export function buildAdminCommandAccessScopeLookupKeys(scope: string): string[] {
  const normalized = normalizeAdminCommandAccessScope(scope);
  if (normalized === GLOBAL_SCOPE) return [GLOBAL_SCOPE];
  const parts = normalized.split(":");
  if (parts[0] !== START_STOP_SCOPE || parts.length <= 1) return [normalized];
  const rest = parts.slice(1).join(":");
  return [normalized, `start:${rest}`, `stop:${rest}`];
}

function hasMapGetter(value: AdminCommandAccessByCommand): value is Map<string, AdminCommandAccessConfig | null | undefined> {
  return typeof value.get === "function";
}

export function readAdminCommandAccessForScope(
  scoped: AdminCommandAccessByCommand | null | undefined,
  scope: string
): AdminCommandAccessConfig | null {
  if (!scoped) return null;
  for (const key of buildAdminCommandAccessScopeLookupKeys(scope)) {
    const value = hasMapGetter(scoped) ? scoped.get(key) : scoped[key];
    if (value) return value;
  }
  return null;
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
  const normalizedEntries = new Map<string, AdminCommandAccessConfig>();
  for (const [scope, access] of entries) {
    if (!access?.roleId || !access.mode) continue;
    const normalized = normalizeAdminCommandAccessScope(scope);
    if (!normalizedEntries.has(normalized)) normalizedEntries.set(normalized, access);
  }
  return Array.from(normalizedEntries.entries()).sort(([left], [right]) => left.localeCompare(right));
}
