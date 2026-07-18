"use strict";

import { COMMAND_ACCESS_MANIFEST, COMMAND_CATALOG_HELP } from "./commandCatalog.js";
import { createCommandHandlerDescriptors } from "../command-registry/commandHandlerDescriptors.js";

export type CommandManifestEntry = {
  command: string;
  access: string;
  help: readonly string[];
};

function topLevel(value: string): string {
  return value.replace(/^\/+/, "").split(" ")[0] ?? "";
}

export function buildCommandManifest(): readonly CommandManifestEntry[] {
  const helpByCommand = new Map<string, string[]>();
  for (const entry of COMMAND_CATALOG_HELP) {
    const key = topLevel(entry.command);
    const rows = helpByCommand.get(key) ?? [];
    rows.push(entry.command);
    helpByCommand.set(key, rows);
  }
  return Object.freeze(COMMAND_ACCESS_MANIFEST.map(rule => ({ command: rule.command, access: rule.access, help: Object.freeze(helpByCommand.get(rule.command) ?? []) })));
}

export function assertCommandManifestConsistency(): void {
  const manifest = buildCommandManifest();
  const keys = new Set<string>();
  for (const entry of manifest) {
    if (keys.has(entry.command)) throw new Error(`Manifestul comenzilor contine duplicat: ${entry.command}`);
    keys.add(entry.command);
    if (!entry.help.length) throw new Error(`Comanda ${entry.command} nu are descriere help canonica`);
  }
  createCommandHandlerDescriptors();
}
