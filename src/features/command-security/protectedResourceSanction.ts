"use strict";

import { describeSanctionOutcome } from "./elevatedRoleSanction.js";

import type { SanctionOutcome } from "./elevatedRoleSanction.js";

export interface IncidentReport {
  actorId: string | null;
  resourceLabel: string;
  actions: readonly string[];
  restored: boolean;
  recreatedId: string | null;
  outcome: SanctionOutcome;
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
    report.actorId
      ? `<@${report.actorId}> a modificat o resursa protejata fara aprobare.`
      : "O resursa protejata a fost modificata fara aprobare, iar autorul nu a putut fi confirmat.",
    `Resursa: ${report.resourceLabel}`,
    `Motiv: ${actions || "modificare neautorizata"} fara aprobare activa de tip protected-resource-change`,
    report.recreatedId
      ? `Resursa a fost recreata din snapshot cu ID nou \`${report.recreatedId}\`; mesajele, invitatiile si referintele vechi nu pot fi recuperate.`
      : report.restored
        ? "Modificarea a fost restaurata din snapshot."
        : "Modificarea NU a putut fi restaurata; verificare manuala necesara.",
    describeSanctionOutcome(report.outcome)
  ];
  return lines.join("\n");
}
