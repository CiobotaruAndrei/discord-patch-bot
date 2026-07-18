"use strict";

import type { ConfigBackupRecord, GuildConfigurationSettings, GuildSettings } from "../../types.js";
import { clampJoinedList } from "../command-presentation/discordListLimit.js";
import { CONFIG_BACKUP_KEYS } from "../admin-records/configBackupRepository.js";

const RESOURCE_FIELDS: Array<{ key: keyof GuildConfigurationSettings; label: string; kind: "canal" | "rol" }> = [
  { key: "notificationChannelId", label: "canal update-uri", kind: "canal" },
  { key: "discountChannelId", label: "canal reduceri", kind: "canal" },
  { key: "youtubeNotificationChannelId", label: "canal YouTube", kind: "canal" },
  { key: "adminAlertChannelId", label: "canal alerte admin", kind: "canal" },
  { key: "notificationRoleId", label: "rol update-uri", kind: "rol" },
  { key: "discountRoleId", label: "rol reduceri", kind: "rol" }
];

export type BackupDiscordResource = { id: string; name?: string; kind: "canal" | "rol" };
export type BackupRestorePlan = { missing: string[]; present: string[]; remap: Record<string, string>; actions: string[] };

export function buildBackupRestorePlan(backup: ConfigBackupRecord, resources: BackupDiscordResource[]): BackupRestorePlan {
  const available = new Map(resources.map(resource => [`${resource.kind}:${resource.id}`, resource]));
  const missing: string[] = [];
  const present: string[] = [];
  const remap: Record<string, string> = {};
  for (const field of RESOURCE_FIELDS) {
    const value = backup.snapshot[field.key];
    if (typeof value !== "string" || !value) continue;
    const key = `${field.kind}:${value}`;
    if (available.has(key)) present.push(`${field.label}:${value}`);
    else missing.push(`${field.label}:${value}`);
  }
  return { missing, present, remap, actions: [...missing.map(item => `recreeaza ${item}`), ...present.map(item => `pastreaza ${item}`)] };
}

function formatDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data necunoscuta";
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

function formatUserReference(userId: string): string {
  return userId ? `<@${userId}>` : "user necunoscut";
}

export function renderBackupList(backups: ConfigBackupRecord[]): string {
  if (!backups.length) return "Nu exista backup-uri salvate pentru acest server.";
  const lines = backups.map(backup => `- \`${backup.name}\` creat de ${formatUserReference(backup.createdBy || "")} la ${formatDate(backup.createdAt)}`);
  return clampJoinedList(lines, 1900);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map) return value.size > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function renderBackupPreview(backup: ConfigBackupRecord, current: GuildSettings | null): string {
  const snapshot = backup.snapshot;
  const changed: string[] = [];
  for (const key of CONFIG_BACKUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    const currentValue = current?.[key];
    const value = snapshot[key];
    if (JSON.stringify(currentValue ?? null) !== JSON.stringify(value ?? null)) changed.push(key);
  }
  const cleared: string[] = [];
  for (const key of CONFIG_BACKUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key) && hasMeaningfulValue(current?.[key])) cleared.push(key);
  }
  const resourceLines = RESOURCE_FIELDS.flatMap(field => {
    const value = snapshot[field.key];
    if (typeof value !== "string" || !value) return [];
    const mention = field.kind === "canal" ? `<#${value}>` : `<@&${value}>`;
    return [`${field.label}: ${mention}`];
  });
  const changedText = changed.length ? clampJoinedList(changed.map(key => `\`${key}\``), 1000, { separator: ", " }) : "nicio diferenta detectata fata de configuratia curenta";
  const clearedText = cleared.length ? clampJoinedList(cleared.map(key => `\`${key}\``), 1000, { separator: ", " }) : "niciuna";
  const resources = resourceLines.length ? resourceLines.join("\n") : "backup-ul nu contine canale sau roluri configurate";
  return [
    `Preview backup \`${backup.name}\`:`,
    `Setari care se vor restaura: ${changedText}`,
    `Setari care se vor STERGE (exista acum, dar lipsesc din backup): ${clearedText}`,
    "",
    "Canale si roluri referite de backup:",
    resources,
    "",
    "Load-ul inlocuieste configuratia botului cu cea din backup: cheile prezente se seteaza, iar cele lipsa din backup se curata (revin la implicit). Daca un canal sau rol a fost sters din Discord, adminul trebuie sa-l recreeze sau sa refaca setarea dupa load."
  ].join("\n");
}
