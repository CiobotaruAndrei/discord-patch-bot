import { createSecurityRuntime } from "../../features/command-security/securityRuntime.js";
import { createReputationEngine } from "../../features/command-security/reputationEngine.js";
import { createPermissionDelegationRuntime } from "../../features/command-security/permissionDelegationRuntime.js";
import { createModerationGuardGate } from "../../features/command-security/moderationGuardGate.js";
import { createProtectedResourceRuntime } from "../../features/command-security/protectedResourceRuntime.js";
import { createWebhookGuardRuntime } from "../../features/command-security/webhookGuardRuntime.js";
import type { WebhookGuardRuntime } from "../../features/command-security/webhookGuardRuntime.js";
import { adaptWebhookGuardChannel } from "./webhookGuardChannelAdapter.js";
import { createMassModerationRuntime } from "../../features/command-security/massModerationRuntime.js";
import { adaptMassModerationGuild } from "./massModerationGuildAdapter.js";
import { createAttachmentBytesReader } from "../../infra/http/attachmentBytes.js";
import { adaptDelegationSanctionContext, type SanctionableGuild } from "./sanctionActorAdapter.js";
import { createServerStructureGuardRuntime } from "../../features/command-security/serverStructureGuardRuntime.js";
import type { ServerStructureGuardRuntime } from "../../features/command-security/serverStructureGuardRuntime.js";
import type { AdaptableWebhookChannel } from "./webhookGuardChannelAdapter.js";
import { createAntiRaidRuntime } from "../../features/command-security/antiRaidRuntime.js";
import { createAdProtectionRuntime } from "../../features/command-security/adProtectionRuntime.js";
import type { AdProtectionRuntime } from "../../features/command-security/adProtectionRuntime.js";
import { addWarning } from "../../features/moderation/moderationRepository.js";
import type { AntiRaidRuntime } from "../../features/command-security/antiRaidRuntime.js";
import { adaptRaidGuild, findRaidStructureActor } from "./antiRaidGuildAdapter.js";
import { createRaidRecoveryRuntime } from "../../features/command-security/raidRecoveryRuntime.js";
import { adaptRecoveryGuild } from "./raidRecoveryGuildAdapter.js";
import type { AdaptableRecoveryGuild } from "./raidRecoveryGuildAdapter.js";
import type { AdaptableRaidGuild } from "./antiRaidGuildAdapter.js";
import type { ProtectedResourceRuntime } from "../../features/command-security/protectedResourceRuntime.js";
import { createPermissionRequestRepository } from "../../features/command-security/permissionRequestRepository.js";
import { createServerEventLogRuntime } from "../../features/command-security/serverEventLogRuntime.js";
import { observeConfirmedBotAction } from "../../features/command-security/botObservationRepository.js";
import { recordServerAuditEntry } from "../../features/admin-records/auditLogRepository.js";
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
import { SECURITY_FIELDS } from "../../shared/guildSecurityFields.js";
import { createProtectedResourceRepository } from "../../features/command-security/protectedResourceRepository.js";

export type GatewayFeatureRuntimes = {
  readonly securityRuntime?: SecurityGatewayRuntime;
  readonly permissionDelegationRuntime?: PermissionDelegationGatewayRuntime;
  readonly serverEventLogRuntime?: ServerEventLogGatewayRuntime;
  readonly protectedResourceRuntime?: ProtectedResourceRuntime;
  readonly antiRaidRuntime?: AntiRaidRuntime;
  readonly adProtectionRuntime?: AdProtectionRuntime;
  readonly webhookGuardRuntime?: WebhookGuardRuntime<AdaptableWebhookChannel>;
  readonly serverStructureGuardRuntime?: ServerStructureGuardRuntime;
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
      PermissionRequestModel: mongo.PermissionRequestModel,
      isRaidConfirmed: guildId => raidConfirmedCheck(guildId),
      sanctionContext: async guildId => adaptDelegationSanctionContext(
        (client.guilds?.cache as { get?: (id: string) => SanctionableGuild | undefined } | undefined)?.get?.(guildId)
      ),
      logger,
      metrics: recorders.security
    })
    : undefined;

  const protectedResources = mongo.ProtectedResourceModel
    ? createProtectedResourceRepository(mongo.ProtectedResourceModel)
    : undefined;

  const raidRecovery = mongo.RaidSnapshotModel
    ? createRaidRecoveryRuntime({
      RaidSnapshotModel: mongo.RaidSnapshotModel,
      onResourceRecreated: protectedResources
        ? async (guildId, previousResourceId, nextResourceId) => {
          const record = await protectedResources.read(guildId, previousResourceId).catch(() => null);
          if (!record?.deletedDuringRaidAt) return undefined;
          return protectedResources.rebind(guildId, previousResourceId, nextResourceId);
        }
        : undefined,
      logger
    })
    : undefined;

  const applyProtection = async (guildId: string, field: string, enabled: boolean): Promise<boolean> => {
    const securityField = SECURITY_FIELDS.some(entry => entry === field);
    const target = securityField ? mongo.GuildSecurityModel : mongo.GuildModel;
    if (!target) return false;
    const result = await target
      .updateOne({ _id: guildId }, { $set: { [field]: enabled } }, { upsert: true })
      .catch(() => null);
    return result !== null;
  };

  const raidState: { check?: (guildId: string) => Promise<boolean> } = {};
  const raidConfirmedCheck = async (guildId: string): Promise<boolean> =>
    raidState.check ? raidState.check(guildId) : false;

  const permissionRequestModel = mongo.PermissionRequestModel;
  const readGuildSettings = mongo.getGuildSettings;
  const antiRaidRuntime = mongo.RaidIncidentModel && readGuildSettings
    ? createAntiRaidRuntime({
      RaidIncidentModel: mongo.RaidIncidentModel,
      readGuildSettings: guildId => readGuildSettings(guildId),
      isGuildOwner: async (guildId, actorId) => {
        const cache = client.guilds?.cache as { get?: (id: string) => { ownerId?: unknown } | undefined } | undefined;
        return cache?.get?.(guildId)?.ownerId === actorId;
      },
      consumeStructureApproval: permissionRequestModel
        ? async (guildId, actorId, resourceId, action) => {
          const approval = await createPermissionRequestRepository(permissionRequestModel)
            .consume(guildId, "server-structure", actorId, { target: resourceId, action })
            .catch(() => null);
          return approval !== null;
        }
        : undefined,
      resolveGuild: async guildId => {
        const cache = client.guilds?.cache as { get?: (id: string) => AdaptableRaidGuild | undefined } | undefined;
        const guild = cache?.get?.(guildId);
        if (!guild) return null;
        const port = adaptRaidGuild(guild, readGuildSettings, logger);
        const recovery = raidRecovery ? adaptRecoveryGuild(guild as AdaptableRecoveryGuild, readGuildSettings, applyProtection, body => port.publish(body)) : null;
        if (!raidRecovery || !recovery) return port;
        return {
          ...port,
          captureStructureSnapshot: (incidentId, incidentStartedAt) =>
            raidRecovery.captureBeforeContainment(recovery, incidentId, incidentStartedAt),
          freezeStructureBaseline: () => raidRecovery.freezeBaseline(guildId),
          releaseStructureBaseline: async () => {
            await raidRecovery.releaseBaseline(guildId);
            return raidRecovery.refreshBaseline(recovery);
          },
          refreshStructureBaseline: () => raidRecovery.refreshBaseline(recovery),
          restoreStructure: async incidentId => {
            const outcome = await raidRecovery.restore(recovery, incidentId);
            if (outcome.kind === "nothing-to-restore") return { complete: true, blocked: 0 };
            if (outcome.kind === "no-snapshot") return { complete: false, blocked: 1 };
            return {
              complete: outcome.complete,
              blocked: outcome.operations.filter(entry => entry.status === "owner-intervention-required").length
            };
          }
        };
      },
      findStructureActor: async (guildId, resourceId) => {
        const cache = client.guilds?.cache as { get?: (id: string) => AdaptableRaidGuild | undefined } | undefined;
        const guild = cache?.get?.(guildId);
        return guild ? findRaidStructureActor(guild, resourceId) : null;
      },
      logger
    })
    : undefined;


async function applyWarnBan(
  guildId: string,
  userId: string,
  limit: number,
  count: number
): Promise<"applied" | "failed" | "not-reached"> {
  if (limit <= 0 || count < limit) return "not-reached";
  const cache = client.guilds?.cache as { get?: (id: string) => { members?: { fetch?: (id: string) => Promise<unknown> } } | undefined } | undefined;
  const member = await Promise.resolve(cache?.get?.(guildId)?.members?.fetch?.(userId)).catch(() => null);
  const bannable = member as { bannable?: boolean; ban?: (options?: Record<string, unknown>) => Promise<unknown> } | null;
  if (!bannable?.ban || bannable.bannable === false) return "failed";
  return bannable.ban({ reason: `Limita de warn-uri atinsa (${limit})` }).then(() => "applied" as const).catch(() => "failed" as const);
}

  const adRequestModel = mongo.AdRequestModel;
  const adAttemptModel = mongo.AdAttemptModel;
  const moderationGuildModel = mongo.GuildModel;
  const adProtectionRuntime = adRequestModel && adAttemptModel && readGuildSettings && moderationGuildModel
    ? createAdProtectionRuntime({
      AdRequestModel: adRequestModel,
      AdAttemptModel: adAttemptModel,
      fetchAttachmentBytes: createAttachmentBytesReader(),
      readGuildSettings: guildId => readGuildSettings(guildId),
      readOwnerId: guildId => {
        const cache = client.guilds?.cache as { get?: (id: string) => { ownerId?: unknown } | undefined } | undefined;
        const ownerId = cache?.get?.(guildId)?.ownerId;
        return typeof ownerId === "string" ? ownerId : null;
      },
      isRaidConfirmed: antiRaidRuntime ? guildId => antiRaidRuntime.isRaidConfirmed(guildId) : undefined,
      issueWarn: async (guildId, userId, username, reason) => {
        const result = await addWarning(moderationGuildModel, guildId, {
          warningId: `ad-${Date.now().toString(36)}`,
          userId,
          username: `${username} (${reason})`,
          moderatorId: client.user?.id ?? "",
          warnedAt: new Date()
        }).catch(() => null);
        if (!result) return null;
        return { ...result, autoBan: await applyWarnBan(guildId, userId, result.limit, result.count) };
      },
      publish: async (guildId, body) => {
        const settings = await readGuildSettings(guildId).catch(() => null);
        const channelId = settings?.adAlertChannelId;
        if (!channelId) return undefined;
        const channel = await Promise.resolve(client.channels?.fetch?.(channelId)).catch(() => null);
        return channel?.send ? channel.send({ content: body }) : undefined;
      },
      logger
    })
    : undefined;

  if (antiRaidRuntime) raidState.check = guildId => antiRaidRuntime.isRaidConfirmed(guildId);

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
        consumeResourceApproval: (guildId, requesterId, resourceId, actions) =>
          createPermissionRequestRepository(permissionRequestModel)
            .consumeAll(
              guildId,
              "protected-resource-change",
              requesterId,
              actions.map(action => ({ target: resourceId, action }))
            )
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

  const publishToRequestChannel = async (guildId: string, body: string): Promise<void> => {
    if (!readGuildSettings) return;
    const settings = await readGuildSettings(guildId).catch(() => null);
    const channelId = settings?.permissionRequestChannelId;
    if (!channelId) return;
    const channel = await Promise.resolve(client.channels?.fetch?.(channelId)).catch(() => null);
    if (channel?.send) await channel.send({ content: body });
  };

  const auditLogModel = mongo.GuildAuditLogModel;
  const webhookGuardCore = mongo.WebhookSnapshotModel && permissionRequestModel && auditLogModel && moderationGuardGate
    ? createWebhookGuardRuntime({
      WebhookSnapshotModel: mongo.WebhookSnapshotModel,
      gate: {
        readSituation: guildId => moderationGuardGate.readSituation(guildId),
        consumeApproval: async (guildId, actorId, channelId, action, webhookId) => {
          const requests = createPermissionRequestRepository(permissionRequestModel);
          const onWebhook = action === "create"
            ? null
            : await requests.consume(guildId, "webhook", actorId, { target: webhookId, action }).catch(() => null);
          return onWebhook ?? requests.consume(guildId, "webhook", actorId, { target: channelId, action });
        }
      },
      publish: publishToRequestChannel,
      recordAudit: async (guildId, entry) => {
        await recordServerAuditEntry(auditLogModel, guildId, entry);
      },
      reportRaidActor: antiRaidRuntime
        ? (guildId, actorId, surface) => antiRaidRuntime.escalateActor(guildId, actorId, surface)
        : undefined,
      reportRaidWebhook: antiRaidRuntime
        ? (guildId, webhookId) => antiRaidRuntime.observeRaidWebhook(guildId, webhookId)
        : undefined,
      logger
    })
    : undefined;

  const webhookGuardRuntime: WebhookGuardRuntime<AdaptableWebhookChannel> | undefined = webhookGuardCore
    ? {
      handleWebhookUpdate: async (channel: AdaptableWebhookChannel) => {
        const adapted = adaptWebhookGuardChannel(channel);
        if (!adapted) return;
        await webhookGuardCore.handleWebhookUpdate(adapted);
      }
    }
    : undefined;

  const massModerationCore = mongo.MassModerationModel && permissionRequestModel && auditLogModel && moderationGuardGate
    ? createMassModerationRuntime({
      MassModerationModel: mongo.MassModerationModel,
      gate: {
        readSituation: guildId => moderationGuardGate.readSituation(guildId),
        consumeApprovals: (guildId, actorId, slices) =>
          createPermissionRequestRepository(permissionRequestModel).consumeAll(
            guildId,
            "moderation-mass",
            actorId,
            slices.map(slice => ({ target: actorId, action: slice.action, amount: slice.amount }))
          )
      },
      publish: publishToRequestChannel,
      recordAudit: async (guildId, entry) => {
        await recordServerAuditEntry(auditLogModel, guildId, entry);
      },
      logger
    })
    : undefined;

  const structureGuardCore = permissionRequestModel && auditLogModel && moderationGuardGate && antiRaidRuntime
    ? createServerStructureGuardRuntime({
      gate: {
        readSituation: guildId => moderationGuardGate.readSituation(guildId),
        consumeApproval: (guildId, actorId, resourceId, action) =>
          createPermissionRequestRepository(permissionRequestModel)
            .consume(guildId, "server-structure", actorId, { target: resourceId, action })
      },
      publish: publishToRequestChannel,
      recordAudit: async (guildId, entry) => {
        await recordServerAuditEntry(auditLogModel, guildId, entry);
      },
      signalAntiRaid: (guildId, resourceId, change) => antiRaidRuntime.observeStructureChange(
        guildId,
        resourceId,
        change.actorId ? { id: change.actorId, bot: false } : null,
        { surface: change.surface, action: change.action, approvalChecked: change.approvalChecked }
      ),
      logger
    })
    : undefined;

  const serverStructureGuardRuntime: ServerStructureGuardRuntime | undefined = structureGuardCore;

  const permissionDelegationRuntime = mongo.GuildAuditLogModel && mongo.GuildModel
    ? createPermissionDelegationRuntime({
      GuildModel: mongo.GuildModel,
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      adminAlert,
      metrics: recorders.permissionDelegation,
      guard: moderationGuardGate,
      sanctionContext: async guildId => adaptDelegationSanctionContext(
        (client.guilds?.cache as { get?: (id: string) => SanctionableGuild | undefined } | undefined)?.get?.(guildId)
      ),
      reportRaidActor: antiRaidRuntime
        ? (guildId, actorId, surface) => antiRaidRuntime.escalateActor(guildId, actorId, surface)
        : undefined
    })
    : undefined;

  const observationModel = mongo.GuildModel;
  const serverEventLogRuntime = mongo.GuildAuditLogModel
    ? createServerEventLogRuntime({
      GuildAuditLogModel: mongo.GuildAuditLogModel,
      logger,
      observeBotAction: observationModel
        ? (guildId, actorId, auditEntryId, kind, at) => observeConfirmedBotAction(observationModel, adminAlert, guildId, actorId, auditEntryId, kind, at)
        : undefined,
      observeMassModeration: massModerationCore
        ? async input => {
          const adapted = adaptMassModerationGuild(input.guild);
          if (!adapted) return undefined;
          return massModerationCore.handleModerationAction(adapted, input.actorId, {
            auditId: input.auditId,
            targetId: input.targetId,
            action: input.action
          });
        }
        : undefined
    })
    : undefined;

  return { securityRuntime, permissionDelegationRuntime, serverEventLogRuntime, protectedResourceRuntime, antiRaidRuntime, adProtectionRuntime, webhookGuardRuntime, serverStructureGuardRuntime };
}

export function createInactiveGatewayFeatureRuntimes(recorders: ThreatSurfaceMetricRecorder): GatewayFeatureRuntimes {
  markGatewayFeaturesInactive(recorders);
  return {};
}
