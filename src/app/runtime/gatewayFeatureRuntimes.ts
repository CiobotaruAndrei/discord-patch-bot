import { createSecurityRuntime } from "../../features/command-security/securityRuntime.js";
import { createReputationEngine } from "../../features/command-security/reputationEngine.js";
import { createPermissionDelegationRuntime } from "../../features/command-security/permissionDelegationRuntime.js";
import { createModerationGuardGate } from "../../features/command-security/moderationGuardGate.js";
import { createProtectedResourceRuntime } from "../../features/command-security/protectedResourceRuntime.js";
import { createAntiRaidRuntime } from "../../features/command-security/antiRaidRuntime.js";
import type { AntiRaidRuntime } from "../../features/command-security/antiRaidRuntime.js";
import { adaptRaidGuild, findRaidStructureActor } from "./antiRaidGuildAdapter.js";
import type { AdaptableRaidGuild } from "./antiRaidGuildAdapter.js";
import type { ProtectedResourceRuntime } from "../../features/command-security/protectedResourceRuntime.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { createServerEventLogRuntime } from "../../features/command-security/serverEventLogRuntime.js";
import { observeConfirmedBotAction } from "../../features/command-security/botObservationRepository.js";
import { createNewAccountAlertDelivery, reconcileStuckNewAccountSends } from "../../features/command-security/newAccountAlertDedup.js";
import { loadYaraRuleset } from "../../features/command-security/yaraRuleset.js";

import type { BotMetrics } from "../health/metricsTypes.js";
import type { MetricRecorders, ThreatSurfaceMetricRecorder } from "../../shared/metricRecorderPorts.js";
import type {
  PermissionDelegationGatewayRuntime,
  SecurityGatewayRuntime,
  ServerEventLogGatewayRuntime
} from "../lifecycle/lifecycleContracts.js";
import type { MongoContextLike, RuntimeServices, ScraperRuntime } from "../appRuntimeContracts.js";

export type GatewayFeatureRuntimes = {
  readonly securityRuntime?: SecurityGatewayRuntime;
  readonly permissionDelegationRuntime?: PermissionDelegationGatewayRuntime;
  readonly serverEventLogRuntime?: ServerEventLogGatewayRuntime;
  readonly protectedResourceRuntime?: ProtectedResourceRuntime;
  readonly antiRaidRuntime?: AntiRaidRuntime;
};

export type GatewayFeatureInput = {
  readonly mongo: MongoContextLike;
  readonly client: RuntimeServices["client"];
  readonly metrics: BotMetrics;
  readonly recorders: MetricRecorders;
  readonly scrapers: ScraperRuntime;
  readonly crypto: { randomBytes(size: number): Buffer };
  readonly onThreatDetails: Parameters<typeof createReputationEngine>[0]["onDetails"];
  readonly onThreatFailure: Parameters<typeof createReputationEngine>[0]["onFailure"];
};

function markGatewayFeaturesInactive(recorders: ThreatSurfaceMetricRecorder): void {
  recorders.reset();
}

export function createGatewayFeatureRuntimes(input: GatewayFeatureInput): GatewayFeatureRuntimes {
  const { mongo, client, metrics, recorders, scrapers, crypto } = input;
  const { logger, env, adminAlert } = mongo;

  const reputationScan = createReputationEngine({
    env,
    httpReq: scrapers.httpReq,
    logger,
    onDetails: input.onThreatDetails,
    onFailure: input.onThreatFailure
  }) ?? undefined;
  recorders.threatSurface.reputationConfigured(Boolean(reputationScan));

  const yaraRuleset = loadYaraRuleset(env.YARA_RULES_PATH, logger);
  recorders.threatSurface.yaraRulesetObserved(yaraRuleset);

  const newAccountAlertModel = mongo.NewAccountAlertDeliveryModel;
  const newAccountDelivery = newAccountAlertModel
    ? createNewAccountAlertDelivery(newAccountAlertModel, () => crypto.randomBytes(16).toString("hex"))
    : null;
  if (newAccountAlertModel) {
    void reconcileStuckNewAccountSends(newAccountAlertModel).then(closed => {
      if (closed > 0) {
        logger("WARN", "NEW_ACCOUNT_ALERT", "Alerte de cont nou ramase in starea de trimitere au fost inchise la pornire ca sent-unconfirmed; NU au fost retrimise", { closed });
      }
    });
  }

  const securityRuntime = mongo.GuildModel && mongo.GuildAuditLogModel
    ? createSecurityRuntime({
      getGuildSettings: mongo.getGuildSettings ?? (async () => null),
      client,
      GuildModel: mongo.GuildModel,
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      httpReq: scrapers.httpReq,
      reputationScan,
      claimNewAccountAlert: newAccountDelivery?.claim,
      logger,
      metrics: recorders.security
    })
    : undefined;

  const permissionRequestModel = mongo.PermissionRequestModel;
  const readGuildSettings = mongo.getGuildSettings;
  const antiRaidRuntime = mongo.RaidIncidentModel && readGuildSettings
    ? createAntiRaidRuntime({
      RaidIncidentModel: mongo.RaidIncidentModel,
      readGuildSettings: guildId => readGuildSettings(guildId),
      resolveGuild: async guildId => {
        const cache = client.guilds?.cache as { get?: (id: string) => AdaptableRaidGuild | undefined } | undefined;
        const guild = cache?.get?.(guildId);
        return guild ? adaptRaidGuild(guild, readGuildSettings, logger) : null;
      },
      findStructureActor: async (guildId, resourceId) => {
        const cache = client.guilds?.cache as { get?: (id: string) => AdaptableRaidGuild | undefined } | undefined;
        const guild = cache?.get?.(guildId);
        return guild ? findRaidStructureActor(guild, resourceId) : null;
      },
      logger
    })
    : undefined;

  const moderationGuardGate = permissionRequestModel && readGuildSettings
    ? createModerationGuardGate({
      PermissionRequestModel: permissionRequestModel,
      readGuildSettings: guildId => readGuildSettings(guildId),
      isRaidConfirmed: antiRaidRuntime ? guildId => antiRaidRuntime.isRaidConfirmed(guildId) : undefined
    })
    : undefined;

  const protectedResourceRuntime = mongo.ProtectedResourceModel && permissionRequestModel && readGuildSettings && moderationGuardGate
    ? createProtectedResourceRuntime({
      ProtectedResourceModel: mongo.ProtectedResourceModel,
      guard: {
        readSituation: guildId => moderationGuardGate.readSituation(guildId),
        consumeResourceApproval: (guildId, requesterId, resourceId, action) =>
          createPermissionRequestRepository(permissionRequestModel)
            .consume(guildId, "protected-resource-change", requesterId, { target: resourceId, action })
      },
      publish: async (guildId, body) => {
        const settings = await readGuildSettings(guildId).catch(() => null);
        const channelId = settings?.permissionRequestChannelId;
        if (!channelId) return undefined;
        const channel = await Promise.resolve(client.channels?.fetch?.(channelId)).catch(() => null);
        return channel?.send ? channel.send({ content: body }) : undefined;
      },
      logger
    })
    : undefined;

  const permissionDelegationRuntime = mongo.GuildAuditLogModel && mongo.GuildModel
    ? createPermissionDelegationRuntime({
      GuildModel: mongo.GuildModel,
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      adminAlert,
      metrics: recorders.permissionDelegation,
      guard: moderationGuardGate
    })
    : undefined;

  const observationModel = mongo.GuildModel;
  const serverEventLogRuntime = mongo.GuildAuditLogModel
    ? createServerEventLogRuntime({
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      logger,
      observeBotAction: observationModel
        ? (guildId, actorId, auditEntryId, kind, at) => observeConfirmedBotAction(observationModel, adminAlert, guildId, actorId, auditEntryId, kind, at)
        : undefined
    })
    : undefined;

  return { securityRuntime, permissionDelegationRuntime, serverEventLogRuntime, protectedResourceRuntime, antiRaidRuntime };
}

export function createInactiveGatewayFeatureRuntimes(recorders: ThreatSurfaceMetricRecorder): GatewayFeatureRuntimes {
  markGatewayFeaturesInactive(recorders);
  return {};
}
