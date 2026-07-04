"use strict";

import type { CommandAccessRule, CommandCatalogDomain, CommandCatalogHelpEntry } from "./commandCatalogTypes";
import { CORE_COMMAND_ACCESS, CORE_CATALOG_HELP } from "./coreCatalog";
import { GAME_INFO_COMMAND_ACCESS, GAME_INFO_CATALOG_HELP } from "./gameInfoCatalog";
import { NOTIFICATIONS_COMMAND_ACCESS, NOTIFICATIONS_CATALOG_HELP } from "./notificationsCatalog";
import { YOUTUBE_COMMAND_ACCESS, YOUTUBE_CATALOG_HELP } from "./youtubeCatalog";
import { ADMIN_COMMAND_ACCESS, ADMIN_CATALOG_HELP } from "./adminCatalog";

export interface CommandModuleDescriptor {
  command: string;
  domain: CommandCatalogDomain;
  access: CommandAccessRule;
  help: readonly CommandCatalogHelpEntry[];
}

const DOMAIN_SLICES: ReadonlyArray<{
  domain: CommandCatalogDomain;
  access: readonly CommandAccessRule[];
  help: readonly CommandCatalogHelpEntry[];
}> = [
  { domain: "core", access: CORE_COMMAND_ACCESS, help: CORE_CATALOG_HELP },
  { domain: "game-info", access: GAME_INFO_COMMAND_ACCESS, help: GAME_INFO_CATALOG_HELP },
  { domain: "notifications", access: NOTIFICATIONS_COMMAND_ACCESS, help: NOTIFICATIONS_CATALOG_HELP },
  { domain: "youtube", access: YOUTUBE_COMMAND_ACCESS, help: YOUTUBE_CATALOG_HELP },
  { domain: "admin", access: ADMIN_COMMAND_ACCESS, help: ADMIN_CATALOG_HELP }
];

function topLevelOf(helpCommand: string): string {
  return helpCommand.replace(/^\/+/, "").split(" ")[0];
}

function buildDescriptors(): CommandModuleDescriptor[] {
  const descriptors: CommandModuleDescriptor[] = [];
  for (const slice of DOMAIN_SLICES) {
    for (const access of slice.access) {
      const help = slice.help.filter(entry => topLevelOf(entry.command) === access.command);
      if (!help.length) {
        throw new Error(`Comanda ${access.command} (domeniul ${slice.domain}) are regula de acces dar nicio intrare de help in acelasi domeniu`);
      }
      descriptors.push({ command: access.command, domain: slice.domain, access, help });
    }
    for (const entry of slice.help) {
      const command = topLevelOf(entry.command);
      if (!slice.access.some(rule => rule.command === command)) {
        throw new Error(`Intrarea de help ${entry.command} (domeniul ${slice.domain}) nu are regula de acces in acelasi domeniu`);
      }
    }
  }
  return descriptors;
}

export const COMMAND_MODULE_DESCRIPTORS: readonly CommandModuleDescriptor[] = buildDescriptors();

export function descriptorFor(command: string): CommandModuleDescriptor | null {
  return COMMAND_MODULE_DESCRIPTORS.find(descriptor => descriptor.command === command) ?? null;
}
