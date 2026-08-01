"use strict";

import type { ProtectedResourceRecord } from "../command-security/protectedResourceTypes.js";

const TYPE_LABELS: Record<string, string> = {
  channel: "Canal",
  category: "Categorie",
  role: "Rol"
};

function timestamp(value: Date | null): string {
  return value ? new Date(value).toISOString().replace("T", " ").slice(0, 16) : "-";
}

export function displayProtectedResource(record: ProtectedResourceRecord): string {
  const lines = [
    `**${TYPE_LABELS[record.type] ?? record.type}** \`${record.resourceId}\` — ${record.snapshot.name || "(fara nume salvat)"}`,
    `Snapshot: ${timestamp(record.snapshotAt)}; overwrite-uri salvate: ${record.snapshot.overwrites.length}`,
    `Stare: ${record.degraded ? "degraded" : "protectie completa"}; prevenire aplicata: ${record.preventionApplied ? "da" : "nu"}`
  ];
  if (record.degraded && record.degradedReasons.length > 0) {
    lines.push(...record.degradedReasons.map(reason => `  - ${reason}`));
  }
  if (record.lastRestoredAt) {
    lines.push(`Ultima restaurare: ${timestamp(record.lastRestoredAt)}${record.recreatedFromId ? ` (recreata din \`${record.recreatedFromId}\`)` : ""}`);
  }
  return lines.join("\n");
}

export function orderProtectedResources(records: readonly ProtectedResourceRecord[]): ProtectedResourceRecord[] {
  return [...records].sort((left, right) => {
    if (left.degraded !== right.degraded) return left.degraded ? -1 : 1;
    if (left.type !== right.type) return left.type.localeCompare(right.type);
    return new Date(left.addedAt).getTime() - new Date(right.addedAt).getTime();
  });
}

export function protectedResourceLines(records: readonly ProtectedResourceRecord[]): string[] {
  if (records.length === 0) return [];
  const degraded = records.filter(record => record.degraded).length;
  const header = degraded > 0
    ? `Resurse protejate: ${records.length}, dintre care **${degraded} degraded** (protectia preventiva nu poate fi garantata).`
    : `Resurse protejate: ${records.length}. Toate au protectie completa.`;
  return [header, ...orderProtectedResources(records).map(displayProtectedResource)];
}
