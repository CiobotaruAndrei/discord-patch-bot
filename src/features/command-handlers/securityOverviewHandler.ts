"use strict";

import { PermissionFlagsBits } from "discord.js";
import { buildSecurityStatus, renderSecurityStatus } from "../command-security/securityStatusModel.js";
import { mergeSecurityLog, renderSecurityLog } from "../command-security/securityLogModel.js";
import { createAdProtectionRepository } from "../command-security/adProtectionRepository.js";
import { createRaidSnapshotRepository } from "../command-security/raidSnapshotRepository.js";
import { antiRaidReadiness } from "../command-security/protectionReadiness.js";
import { moderationGuardReadiness, readinessGapsByProtection } from "../command-security/moderationGuardReadiness.js";
import { START_STOP_TOGGLE_FIELDS } from "../command-security/securityCommandFields.js";

import { orderIncidents, toLogEntry } from "../command-security/securityIncidentContract.js";
import {
  projectAdAttempts,
  projectAdRequest,
  projectAuditEntry,
  projectPermissionRequest,
  projectRaidIncident
} from "../command-security/securityIncidentProjection.js";

import type { SecurityLogEntry, SecurityLogSource } from "../command-security/securityLogModel.js";
import type { SecurityStatusInput } from "../command-security/securityStatusModel.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";
import { listServerAuditEntries } from "../admin-records/auditLogRepository.js";
import { createRaidIncidentRepository } from "../command-security/antiRaidIncidentRepository.js";
import { createPermissionRequestRepository } from "../command-security/permissionRequestRepository.js";
import { createProtectedResourceRepository } from "../command-security/protectedResourceRepository.js";
import type { GuildAuditLogModelLike } from "../admin-records/auditLogRepository.js";
import type { RaidIncidentModelLike } from "../command-security/antiRaidIncidentRepository.js";
import type { PermissionRequestModelLike } from "../command-security/permissionRequestRepository.js";
import type { ProtectedResourceModelLike } from "../command-security/protectedResourceRepository.js";
import type { AdAttemptModelLike, AdRequestModelLike } from "../command-security/adProtectionRepository.js";
import type { RaidSnapshotModelLike } from "../command-security/raidSnapshotRepository.js";
import type { GuildSettingsLike } from "../command-security/securitySettingsContracts.js";
import type { SecurityInteraction } from "../command-security/securityInteractionContracts.js";

type SecurityOverviewGuild = NonNullable<SecurityInteraction["guild"]>;

export interface SecurityOverviewDeps {
  readLog: (guildId: string) => Promise<SecurityLogEntry[]>;
  readStatus: (guildId: string, guild?: SecurityOverviewGuild) => Promise<SecurityStatusInput>;
}

export interface SecurityOverviewRequest {
  guildId: string;
  command: "security-log" | "security-status";
  source: SecurityLogSource | null;
  page: number;
  guild?: SecurityOverviewGuild;
}

export async function runSecurityOverview(
  request: SecurityOverviewRequest,
  deps: SecurityOverviewDeps
): Promise<string> {
  if (request.command === "security-status") {
    const input = await deps.readStatus(request.guildId, request.guild);
    return renderSecurityStatus(buildSecurityStatus(input));
  }

  const entries = mergeSecurityLog(await deps.readLog(request.guildId));
  const filtered = request.source ? entries.filter(entry => entry.source === request.source) : entries;
  return renderSecurityLog(filtered, request.page);
}

interface OverviewInteraction {
  commandName?: string;
  guild?: SecurityOverviewGuild | null;
  options?: {
    getString?: (name: string, required?: boolean) => string | null;
    getInteger?: (name: string, required?: boolean) => number | null;
  };
  isChatInputCommand?: () => boolean;
  reply: (payload: { content: string; ephemeral: boolean }) => Promise<unknown>;
}

const OVERVIEW_COMMANDS = ["security-log", "security-status"] as const;

export function isSecurityOverviewInteraction(interaction: OverviewInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  return OVERVIEW_COMMANDS.some(name => name === interaction.commandName);
}

export function readOverviewRequest(interaction: OverviewInteraction): SecurityOverviewRequest | null {
  const guildId = interaction.guild?.id;
  if (!guildId) return null;
  const command = interaction.commandName === "security-status" ? "security-status" : "security-log";
  const rawSource = interaction.options?.getString?.("sursa", false) ?? null;
  const source = rawSource === "audit" || rawSource === "raid" || rawSource === "ad" || rawSource === "approval"
    ? rawSource
    : null;
  return { guildId, command, source, page: interaction.options?.getInteger?.("pagina", false) ?? 1, guild: interaction.guild ?? undefined };
}

export interface SecurityOverviewContext {
  GuildAuditLogModel: GuildAuditLogModelLike;
  RaidIncidentModel: RaidIncidentModelLike;
  PermissionRequestModel: PermissionRequestModelLike;
  ProtectedResourceModel: ProtectedResourceModelLike;
  RaidSnapshotModel: RaidSnapshotModelLike;
  AdRequestModel: AdRequestModelLike;
  AdAttemptModel: AdAttemptModelLike;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
}

const ALERT_CHANNEL_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, label: "View Channel" },
  { flag: PermissionFlagsBits.SendMessages, label: "Send Messages" },
  { flag: PermissionFlagsBits.EmbedLinks, label: "Embed Links" }
] as const;

function missingGuildPermission(guild: SecurityOverviewGuild, flag: bigint, label: string): string[] {
  return guild.members?.me?.permissions?.has(flag) === true ? [] : [label];
}

async function liveReadinessGaps(
  settings: GuildSettingsLike | null,
  guild?: SecurityOverviewGuild
): Promise<Record<string, readonly string[]>> {
  if (!settings || !guild) return {};
  const result: Record<string, readonly string[]> = {};
  for (const [key, fields] of Object.entries(START_STOP_TOGGLE_FIELDS)) {
    if (settings[fields.enabled] !== true) continue;
    const missing: string[] = [];
    const channelId = settings[fields.channel];
    if (typeof channelId === "string" && channelId) {
      const channel = await guild.channels?.fetch(channelId).catch(() => null);
      const permissions = channel && guild.members?.me && channel.permissionsFor
        ? channel.permissionsFor(guild.members.me)
        : null;
      if (!channel) missing.push("canalul configurat nu mai este accesibil");
      else if (!permissions) missing.push(...ALERT_CHANNEL_PERMISSIONS.map(entry => entry.label));
      else missing.push(...ALERT_CHANNEL_PERMISSIONS.filter(entry => permissions.has(entry.flag) !== true).map(entry => entry.label));
    }
    if (key === "anti-raid" || key === "anti-raid-dry-run") missing.push(...antiRaidReadiness({ guild }));
    if (key === "moderation-guard") {
      const report = moderationGuardReadiness(guild.members?.me);
      for (const [subprotection, gaps] of Object.entries(readinessGapsByProtection(report))) {
        if (subprotection !== "moderation-guard") result[subprotection] = gaps;
      }
      missing.push(...new Set(report.flatMap(entry => entry.missing)));
    }
    if (key === "threat-protection" || key === "ad-protection") {
      missing.push(...missingGuildPermission(guild, PermissionFlagsBits.ManageMessages, "Manage Messages"));
    }
    result[key] = [...new Set(missing)];
  }
  return result;
}

export function composeSecurityOverviewDeps(target: SecurityOverviewContext): SecurityOverviewDeps {
  const incidents = createRaidIncidentRepository(target.RaidIncidentModel);
  const approvals = createPermissionRequestRepository(target.PermissionRequestModel);
  const resources = createProtectedResourceRepository(target.ProtectedResourceModel);
  const snapshots = createRaidSnapshotRepository(target.RaidSnapshotModel);
  const ads = createAdProtectionRepository(target.AdRequestModel, target.AdAttemptModel);

  return {
    readLog: async guildId => {
      const [audit, history, permissionRequests, adRequests, adAttempts] = await Promise.all([
        listServerAuditEntries(target.GuildAuditLogModel, guildId, 200),
        incidents.history(guildId, 200),
        approvals.list(guildId, {}, 200),
        ads.listRequests(guildId, 200),
        ads.listAttempts(guildId, 200)
      ]);
      return orderIncidents([
        ...audit.map(projectAuditEntry),
        ...history.map(projectRaidIncident),
        ...permissionRequests.map(projectPermissionRequest),
        ...adRequests.map(projectAdRequest),
        ...adAttempts.flatMap(projectAdAttempts)
      ]).map(toLogEntry);
    },

    readStatus: async (guildId, guild) => {
      const [settings, activeApprovals, protectedList, incident] = await Promise.all([
        target.getGuildSettings(guildId),
        approvals.countActive(guildId),
        resources.list(guildId),
        incidents.active(guildId)
      ]);
      const snapshot = incident ? await snapshots.read(incident._id) : null;
      return {
        settings,
        readinessGaps: await liveReadinessGaps(settings, guild),
        activeApprovals,
        degradedResources: protectedList.filter(item => item.degraded).length,
        ownerInterventionOperations: snapshot?.operations.filter(operation => operation.status === "owner-intervention-required").length ?? 0,
        raidStage: incident?.stage ?? null
      };
    }
  };
}

export function buildCommandHandler(context: SecurityOverviewContext) {
  const target = composeSecurityOverviewDeps(context);
  return {
    canHandle: (interaction: unknown): interaction is OverviewInteraction =>
      isSecurityOverviewInteraction(interaction as OverviewInteraction),
    handle: async (interaction: OverviewInteraction): Promise<unknown> => {
      const request = readOverviewRequest(interaction);
      if (!request) return interaction.reply({ content: "Comanda este disponibila doar pe server.", ephemeral: true });
      try {
        const content = await runSecurityOverview(request, target);
        return interaction.reply({ content, ephemeral: true });
      } catch {
        return interaction.reply({
          content: "Starea de securitate nu poate fi citita acum. Verifica MongoDB si incearca din nou.",
          ephemeral: true
        });
      }
    }
  };
}

export default { buildCommandHandler };

export const SECURITY_OVERVIEW_HANDLER_KEYS = [
  "GuildAuditLogModel",
  "RaidIncidentModel",
  "PermissionRequestModel",
  "ProtectedResourceModel",
  "RaidSnapshotModel",
  "AdRequestModel",
  "AdAttemptModel",
  "getGuildSettings"
] as const;

type OverviewKeyCheckDeps = Parameters<typeof buildCommandHandler>[0];
type OverviewMissing = MissingDependencyKeys<OverviewKeyCheckDeps, (typeof SECURITY_OVERVIEW_HANDLER_KEYS)[number] & string>;
type OverviewExtra = ExtraDependencyKeys<OverviewKeyCheckDeps, (typeof SECURITY_OVERVIEW_HANDLER_KEYS)[number] & string>;
export const overviewKeysComplete: ExactDependencyKeys<OverviewMissing, OverviewExtra> = true;
