"use strict";

export const ELEVATED_PERMISSION_FLAGS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageWebhooks",
  "BanMembers",
  "KickMembers",
  "ModerateMembers"
] as const;

export interface SanctionRole {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  elevated: boolean;
}

export interface SanctionInput {
  actorRoles: readonly SanctionRole[];
  botHighestRolePosition: number | null;
  everyoneRoleId: string;
}

export interface SanctionPlan {
  removable: SanctionRole[];
  blocked: SanctionRole[];
}

export function planRoleSanction(input: SanctionInput): SanctionPlan {
  const removable: SanctionRole[] = [];
  const blocked: SanctionRole[] = [];
  const botPosition = input.botHighestRolePosition;

  for (const role of input.actorRoles) {
    if (!role.elevated || role.id === input.everyoneRoleId) continue;
    if (role.managed || botPosition === null || role.position >= botPosition) {
      blocked.push(role);
      continue;
    }
    removable.push(role);
  }

  return { removable, blocked };
}

export function describeSanction(plan: SanctionPlan): string {
  if (plan.removable.length === 0 && plan.blocked.length === 0) {
    return "Autorul nu avea roluri cu permisiuni ridicate.";
  }
  const parts: string[] = [];
  if (plan.removable.length > 0) {
    parts.push(`Roluri eliminate: ${plan.removable.map(role => role.name).join(", ")}.`);
  }
  if (plan.blocked.length > 0) {
    parts.push(
      `Roluri care NU au putut fi eliminate (gestionate de integrare sau peste rolul botului): ${plan.blocked.map(role => role.name).join(", ")}.`
    );
  }
  return parts.join(" ");
}

export interface IncidentReport {
  actorId: string;
  resourceLabel: string;
  actions: readonly string[];
  restored: boolean;
  recreatedId: string | null;
  plan: SanctionPlan;
}

const ACTION_LABELS: Record<string, string> = {
  delete: "stergere",
  rename: "redenumire",
  move: "mutare",
  reposition: "schimbare de pozitie",
  permissions: "modificare de permisiuni"
};

export function renderIncident(report: IncidentReport): string {
  const actions = report.actions.map(action => ACTION_LABELS[action] ?? action).join(", ");
  const lines = [
    `<@${report.actorId}> a modificat o resursa protejata fara aprobare.`,
    `Resursa: ${report.resourceLabel}`,
    `Motiv: ${actions || "modificare neautorizata"} fara aprobare activa de tip protected-resource-change`,
    report.recreatedId
      ? `Resursa a fost recreata din snapshot cu ID nou \`${report.recreatedId}\`; mesajele, invitatiile si referintele vechi nu pot fi recuperate.`
      : report.restored
        ? "Modificarea a fost restaurata din snapshot."
        : "Modificarea NU a putut fi restaurata; verificare manuala necesara.",
    describeSanction(report.plan)
  ];
  return lines.join("\n");
}
