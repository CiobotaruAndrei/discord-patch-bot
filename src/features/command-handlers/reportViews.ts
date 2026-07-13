import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
"use strict";

import { clampJoinedList } from "../command-presentation/discordListLimit.js";

const feedback = require("../feedback/feedbackRepository").default as {
  reportTypeLabel: (value: string) => string;
};

export interface ReportRecord {
  id?: string;
  guildId: string;
  userId: string;
  type: string;
  gameKey: string;
  detail: string;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string;
}

export function buildReportConfirmEmbed(record: ReportRecord): { title: string; description: string; color: number } {
  const lines = [`**Tip:** ${feedback.reportTypeLabel(record.type)}`];
  if (record.gameKey) lines.push(`**Joc:** ${record.gameKey.slice(0, 100)}`);
  if (record.detail) lines.push(`**Detalii:** ${record.detail.slice(0, 500)}`);
  return {
    title: "Multumesc pentru raport! ✅",
    description: `Am inregistrat raportul tau si il vor vedea administratorii.\n\n${lines.join("\n")}`,
    color: 0x2ecc71
  };
}

export function buildReportAlertBody(record: ReportRecord): string {
  const parts = [
    `Server: ${record.guildId}`,
    `Utilizator: ${record.userId || "?"}`,
    `Tip: ${feedback.reportTypeLabel(record.type)}`
  ];
  if (record.gameKey) parts.push(`Joc: ${record.gameKey}`);
  if (record.detail) parts.push(`Detalii: ${record.detail}`);
  return parts.join("\n");
}

function truncateListText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

export function buildReportListEmbed(records: ReportRecord[]): { title: string; description: string; color: number; footer: { text: string } } {
  if (!records.length) {
    return {
      title: "Rapoarte recente",
      description: "Nu exista rapoarte pentru acest server.",
      color: 0x95a5a6,
      footer: { text: "Foloseste /report submit pentru a inregistra o problema." }
    };
  }

  const lines: string[] = [];
  for (const record of records) {
    const id = record.id || "fara-id";
    const status = record.resolvedAt ? "rezolvat" : "deschis";
    const game = record.gameKey ? ` | joc: ${record.gameKey}` : "";
    const detail = record.detail ? ` | ${truncateListText(record.detail, 120)}` : "";
    lines.push(`\`${id}\` - ${status} - ${feedback.reportTypeLabel(record.type)}${game}${detail}`);
  }

  return {
    title: `Rapoarte recente (${records.length})`,
    description: clampJoinedList(lines, 4096),
    color: records.some(record => !record.resolvedAt) ? 0xe67e22 : 0x2ecc71,
    footer: { text: "Rezolvare: /report resolve id:<id>" }
  };
}
