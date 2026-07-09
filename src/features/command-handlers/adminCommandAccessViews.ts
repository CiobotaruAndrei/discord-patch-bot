"use strict";

import {
  displayAdminCommandAccessScope,
  findAdminCommandAccessScopeConflicts,
  listScopedAdminCommandAccess,
  readAdminCommandAccessForScope,
  type AdminCommandAccessByCommand
} from "../command-security/adminCommandAccessScope";

export type AdminAccessMode = "role" | "role-or-higher";

export type GuildAdminAccessDoc = {
  adminCommandAccess?: {
    mode?: AdminAccessMode | null;
    roleId?: string | null;
    updatedBy?: string | null;
    updatedAt?: Date | string | null;
  } | null;
  adminCommandAccessByCommand?: AdminCommandAccessByCommand | null;
};

export function labelMode(mode: string | null | undefined): string {
  return mode === "role-or-higher" ? "rol sau rol mai mare" : "rol exact";
}

export function normalizeMode(value: string | null): AdminAccessMode | null {
  if (value === "role" || value === "role-or-higher") return value;
  if (value === "exact") return "role";
  if (value === "or-higher") return "role-or-higher";
  return null;
}

export function formatCurrentAccess(scope: string, access: GuildAdminAccessDoc["adminCommandAccess"]): string {
  const scopeText = displayAdminCommandAccessScope(scope);
  if (!access?.roleId || !access.mode) {
    return `Acces admin pentru ${scopeText}: implicit. Pana ownerul seteaza o regula de rol, comenzile admin raman disponibile prin \`Administrator\` sau codul global de acces.`;
  }
  const updatedAt = access.updatedAt ? `\nActualizat la: ${String(access.updatedAt)}` : "";
  const updatedBy = access.updatedBy ? `\nActualizat de: <@${access.updatedBy}>` : "";
  return `Acces admin pentru ${scopeText}: ${labelMode(access.mode)} pentru <@&${access.roleId}>.${updatedBy}${updatedAt}`;
}

export function formatAccessList(doc: GuildAdminAccessDoc | null): string {
  const lines = [formatCurrentAccess("global", doc?.adminCommandAccess || null)];
  for (const [scope, access] of listScopedAdminCommandAccess(doc?.adminCommandAccessByCommand)) {
    lines.push(formatCurrentAccess(scope, access));
  }
  const conflicts = findAdminCommandAccessScopeConflicts(doc?.adminCommandAccessByCommand);
  if (conflicts.length) {
    const conflictLines = conflicts.map(conflict =>
      `- ${displayAdminCommandAccessScope(conflict.scope)}: chei vechi diferite ${conflict.keys.map(key => `\`${key}\``).join(", ")}. Ruleaza din nou \`/set admin-command-access\` pe acest modul ca sa unifici regula (regula noua le inlocuieste).`
    );
    lines.push([":warning: **Reguli in conflict** (chei vechi `start:`/`stop:` cu roluri diferite pentru acelasi modul, altfel ascunse la listare):", ...conflictLines].join("\n"));
  }
  return lines.join("\n\n");
}

export function formatScopedAccess(doc: GuildAdminAccessDoc | null, scope: string): string {
  const exact = readAdminCommandAccessForScope(doc?.adminCommandAccessByCommand, scope);
  if (exact) return formatCurrentAccess(scope, exact);
  const fallback = doc?.adminCommandAccess || null;
  if (fallback) {
    return `${displayAdminCommandAccessScope(scope)} nu are regula dedicata si foloseste fallback-ul global.\n\n${formatCurrentAccess("global", fallback)}`;
  }
  return formatCurrentAccess(scope, null);
}
