"use strict";

import { buildSecurityStatus, renderSecurityStatus } from "../command-security/securityStatusModel.js";
import { mergeSecurityLog, renderSecurityLog } from "../command-security/securityLogModel.js";

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
import type { GuildSettingsLike } from "../command-security/securitySettingsContracts.js";

export interface SecurityOverviewDeps {
  readLog: (guildId: string) => Promise<SecurityLogEntry[]>;
  readStatus: (guildId: string) => Promise<SecurityStatusInput>;
}

export interface SecurityOverviewRequest {
  guildId: string;
  command: "security-log" | "security-status";
  source: SecurityLogSource | null;
  page: number;
}

export async function runSecurityOverview(
  request: SecurityOverviewRequest,
  deps: SecurityOverviewDeps
): Promise<string> {
  if (request.command === "security-status") {
    const input = await deps.readStatus(request.guildId);
    return renderSecurityStatus(buildSecurityStatus(input));
  }

  const entries = mergeSecurityLog(await deps.readLog(request.guildId));
  const filtered = request.source ? entries.filter(entry => entry.source === request.source) : entries;
  return renderSecurityLog(filtered, request.page);
}

interface OverviewInteraction {
  commandName?: string;
  guild?: { id?: string } | null;
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
  return { guildId, command, source, page: interaction.options?.getInteger?.("pagina", false) ?? 1 };
}

export interface SecurityOverviewContext {
  GuildAuditLogModel: GuildAuditLogModelLike;
  RaidIncidentModel: RaidIncidentModelLike;
  PermissionRequestModel: PermissionRequestModelLike;
  ProtectedResourceModel: ProtectedResourceModelLike;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
}

export function composeSecurityOverviewDeps(target: SecurityOverviewContext): SecurityOverviewDeps {
  const incidents = createRaidIncidentRepository(target.RaidIncidentModel);
  const approvals = createPermissionRequestRepository(target.PermissionRequestModel);
  const resources = createProtectedResourceRepository(target.ProtectedResourceModel);

  return {
    readLog: async guildId => {
      const [audit, history] = await Promise.all([
        listServerAuditEntries(target.GuildAuditLogModel, guildId, 200).catch(() => []),
        incidents.history(guildId).catch(() => [])
      ]);
      const auditEntries: SecurityLogEntry[] = audit.map(item => ({
        source: "audit" as const,
        at: item.at instanceof Date ? item.at : new Date(String(item.at)),
        action: item.action,
        actorId: item.userId || null,
        summary: item.details ?? ""
      }));
      const raidEntries: SecurityLogEntry[] = history.map(item => ({
        source: "raid" as const,
        at: item.startedAt instanceof Date ? item.startedAt : new Date(String(item.startedAt)),
        action: `incident ${item.stage}`,
        actorId: null,
        summary: `${item.triggerReason}; participanti: ${item.participants.length}`
      }));
      return [...auditEntries, ...raidEntries];
    },

    readStatus: async guildId => {
      const [settings, activeApprovals, protectedList, incident] = await Promise.all([
        target.getGuildSettings(guildId).catch(() => null),
        approvals.countActive(guildId).catch(() => 0),
        resources.list(guildId).catch(() => []),
        incidents.active(guildId).catch(() => null)
      ]);
      return {
        settings,
        readinessGaps: Object.fromEntries(
          protectedList.filter(item => item.degraded).map(item => [item.resourceId, item.degradedReasons])
        ),
        activeApprovals,
        degradedResources: protectedList.filter(item => item.degraded).length,
        ownerInterventionOperations: 0,
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
      const content = await runSecurityOverview(request, target);
      return interaction.reply({ content, ephemeral: true });
    }
  };
}

export default { buildCommandHandler };

export const SECURITY_OVERVIEW_HANDLER_KEYS = ["GuildAuditLogModel", "RaidIncidentModel", "PermissionRequestModel", "ProtectedResourceModel", "getGuildSettings"] as const;

type OverviewKeyCheckDeps = Parameters<typeof buildCommandHandler>[0];
type OverviewMissing = MissingDependencyKeys<OverviewKeyCheckDeps, (typeof SECURITY_OVERVIEW_HANDLER_KEYS)[number] & string>;
type OverviewExtra = ExtraDependencyKeys<OverviewKeyCheckDeps, (typeof SECURITY_OVERVIEW_HANDLER_KEYS)[number] & string>;
const overviewKeysComplete: ExactDependencyKeys<OverviewMissing, OverviewExtra> = true;
