"use strict";

import { COMMAND_CATALOG_HELP, permissionsLabelFor } from "./commandCatalog";

export const COMMAND_REFERENCE_DOC_RELATIVE_PATH = "docs/Referinta Comenzi.md";

function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function describeEntry(description: string, notes?: readonly string[]): string {
  if (!notes || notes.length === 0) return description;
  return `${description} ${notes.map(note => `Nota: ${note}`).join(" ")}`;
}

export function renderCommandReferenceDoc(): string {
  const lines: string[] = [];
  lines.push("# Referinta Comenzi");
  lines.push("");
  lines.push(
    "> Fisier generat automat din `COMMAND_CATALOG_HELP` (`src/features/command-catalog/commandCatalog.ts`), " +
    "aceeasi sursa unica pe care o foloseste comanda `/help` in Discord. " +
    "Nu edita manual acest fisier: ruleaza `npm run docs:commands` din `src/`. " +
    "Sincronizarea catalog <-> fisier este verificata de `commandReferenceDoc.test.ts` si de `npm run check:docs-commands`."
  );
  lines.push("");
  lines.push(`Total comenzi documentate: ${COMMAND_CATALOG_HELP.length}.`);
  lines.push("");
  lines.push("| Comanda | Permisiuni | Ce face | Exemplu |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of COMMAND_CATALOG_HELP) {
    const permissions = permissionsLabelFor(entry.command, entry.ephemeral);
    const description = describeEntry(entry.description, entry.notes);
    lines.push(
      `| \`${escapeCell(entry.command)}\` | ${escapeCell(permissions)} | ${escapeCell(description)} | \`${escapeCell(entry.example)}\` |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
