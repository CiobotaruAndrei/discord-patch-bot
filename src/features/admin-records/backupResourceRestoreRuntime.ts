"use strict";

import type {
  BackupResourceIdRemap,
  BackupResourceKind,
  BackupResourceRestorePlan
} from "./backupResourceRestorePlan.js";

export interface BackupDiscordResource {
  id: string;
  name?: string;
  delete(reason?: string): Promise<unknown>;
}

export interface BackupDiscordResourceManager {
  cache: { values(): Iterable<BackupDiscordResource> };
  create(options: { name: string; permissions?: never[]; reason: string }): Promise<BackupDiscordResource>;
}

export interface BackupDiscordGuild {
  id: string;
  channels: BackupDiscordResourceManager;
  roles: BackupDiscordResourceManager;
}

export interface MaterializedBackupResources {
  channelIds: Set<string>;
  created: BackupDiscordResource[];
  remap: BackupResourceIdRemap;
  roleIds: Set<string>;
}

function resources(manager: BackupDiscordResourceManager): BackupDiscordResource[] {
  return [...manager.cache.values()];
}

function managerFor(guild: BackupDiscordGuild, kind: BackupResourceKind): BackupDiscordResourceManager {
  return kind === "channel" ? guild.channels : guild.roles;
}

async function rollbackCreated(resourcesToDelete: BackupDiscordResource[]): Promise<void> {
  for (const resource of [...resourcesToDelete].reverse()) {
    try {
      await resource.delete("Compensare dupa esecul restaurarii backup-ului");
    } catch {}
  }
}

export async function materializeBackupResources(
  guild: BackupDiscordGuild,
  plan: BackupResourceRestorePlan
): Promise<MaterializedBackupResources> {
  if (plan.invalid.length > 0) {
    const paths = plan.invalid.map(item => item.path).join(", ");
    throw new Error(`Backup-ul contine referinte Discord invalide: ${paths}`);
  }
  const channelResources = resources(guild.channels);
  const roleResources = resources(guild.roles);
  const channelIds = new Set(channelResources.map(resource => resource.id));
  const roleIds = new Set(roleResources.map(resource => resource.id));
  const channels = new Map<string, string>();
  const roles = new Map<string, string>();
  const created: BackupDiscordResource[] = [];
  try {
    for (const entry of plan.missing) {
      const manager = managerFor(guild, entry.kind);
      const current = entry.kind === "channel" ? channelResources : roleResources;
      let resource = current.find(candidate => candidate.name === entry.createName);
      if (!resource) {
        resource = await manager.create({
          name: entry.createName,
          permissions: entry.kind === "role" ? [] : undefined,
          reason: `Restaurare backup: ${entry.references.map(reference => reference.path).join(", ")}`
        });
        current.push(resource);
        created.push(resource);
      }
      const remap = entry.kind === "channel" ? channels : roles;
      remap.set(entry.oldId, resource.id);
      (entry.kind === "channel" ? channelIds : roleIds).add(resource.id);
    }
  } catch (error) {
    await rollbackCreated(created);
    throw error;
  }
  return { channelIds, created, remap: { channels, roles }, roleIds };
}

export default { materializeBackupResources };
