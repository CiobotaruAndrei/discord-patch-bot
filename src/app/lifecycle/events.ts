import type { BotRole } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { RuntimeEnv } from "../../config/runtimeEnvTypes.js";
import type { CommandMetricRecorder, SecurityMetricRecorder } from "../../shared/metricRecorderPorts.js";
import type { LifecycleDiscordChannel, LifecycleDiscordDeletedChannel, LifecycleDiscordGuild, LifecycleDiscordGuildMember, LifecycleDiscordInteraction, LifecycleDiscordMessage, LifecycleDiscordRole, LifecycleEventClient } from "./lifecycleContracts.js";
import type { ModerationLifecycleGatewayRuntime, PermissionDelegationGatewayRuntime, SecurityGatewayRuntime, ServerEventLogGatewayRuntime } from "./lifecycleContracts.js";
import { createGuildOnboarding } from "./guildOnboarding.js";
import { roleRunsSchedulers, roleRunsInteractions } from "../../shared/botRole.js";
import { adaptProtectedResourceGuild } from "../runtime/protectedResourceGuildAdapter.js";
import type { AdaptableGuild } from "../runtime/protectedResourceGuildAdapter.js";
import type { ResourceLike } from "../../features/command-security/protectedResourceTypes.js";
import type { ProtectedResourceRuntime } from "../../features/command-security/protectedResourceRuntime.js";
import type { AntiRaidRuntime } from "../../features/command-security/antiRaidRuntime.js";
import type { AdProtectionRuntime } from "../../features/command-security/adProtectionRuntime.js";
import type { WebhookGuardRuntime } from "../../features/command-security/webhookGuardRuntime.js";
import type { AdaptableWebhookChannel } from "../runtime/webhookGuardChannelAdapter.js";
import type { ServerStructureGuardRuntime } from "../../features/command-security/serverStructureGuardRuntime.js";
import type { StructureChangeKind } from "../../features/command-security/serverStructureActions.js";
import { adaptStructureGuardGuild } from "../runtime/serverStructureGuildAdapter.js";
import type { AdaptableStructureGuild } from "../runtime/serverStructureGuildAdapter.js";

type LifecycleLogger = (level: "INFO" | "WARN" | "ERROR", context: string, message: string, meta?: unknown) => void;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;

interface CommandsLike {
  registerSlashCommands(token: string, clientId: string): Promise<unknown>;
  handleInteraction(interaction: LifecycleDiscordInteraction, games: GameConfig[]): Promise<unknown> | unknown;
  canSendEmbeds(channel: LifecycleDiscordChannel, botId: string): boolean;
}

interface CryptoLike {
  randomBytes(size: number): Buffer;
}

interface RequestContextLike {
  run<T>(store: { requestId: string }, callback: () => T): T;
}

interface RegisterDiscordEventsDeps {
  client: LifecycleEventClient;
  logger: LifecycleLogger;
  commands: CommandsLike;
  metrics: { security: SecurityMetricRecorder; command: CommandMetricRecorder };
  env: RuntimeEnv;
  adminAlert: AdminAlert;
  requestContext: RequestContextLike;
  games: GameConfig[];
  crypto: CryptoLike;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
  startHousekeeping?: () => void;
  scheduleNextCron?: () => void;
  startOutboxWorker?: () => void;
  role?: BotRole;
  securityRuntime?: SecurityGatewayRuntime;
  permissionDelegationRuntime?: PermissionDelegationGatewayRuntime;
  moderationLifecycleRuntime?: ModerationLifecycleGatewayRuntime;
  serverEventLogRuntime?: ServerEventLogGatewayRuntime;
  protectedResourceRuntime?: ProtectedResourceRuntime;
  antiRaidRuntime?: AntiRaidRuntime;
  adProtectionRuntime?: AdProtectionRuntime;
  webhookGuardRuntime?: WebhookGuardRuntime<AdaptableWebhookChannel>;
  serverStructureGuardRuntime?: ServerStructureGuardRuntime;
}

interface MongoConnectionLike {
  on(event: "connected" | "disconnected" | "reconnected", listener: () => unknown): unknown;
  on(event: "error", listener: (err: unknown) => unknown): unknown;
}

interface MongooseLike {
  connection: MongoConnectionLike;
}

interface RegisterMongoEventsDeps {
  mongoose: MongooseLike;
  logger: LifecycleLogger;
  errorMessage: ErrorFormatter;
}

const EPHEMERAL_MESSAGE_FLAG = 64;

async function replyInteractionError(inter: LifecycleDiscordInteraction): Promise<void> {
  if (typeof inter?.isRepliable !== "function" || !inter.isRepliable()) return;
  const payload = { content: "A aparut o eroare la procesarea comenzii. Incearca din nou mai tarziu.", flags: EPHEMERAL_MESSAGE_FLAG };
  const send = (inter.deferred || inter.replied) && typeof inter.followUp === "function"
    ? inter.followUp(payload)
    : (typeof inter.reply === "function" ? inter.reply(payload) : Promise.resolve(undefined));
  await Promise.resolve(send).catch(() => null);
}

function registerDiscordEvents({
  client, logger, commands, metrics, env, adminAlert, requestContext,
  games, crypto, errorMessage, errorDetail, startHousekeeping, scheduleNextCron, startOutboxWorker, role, securityRuntime,
  permissionDelegationRuntime, moderationLifecycleRuntime, serverEventLogRuntime, protectedResourceRuntime, antiRaidRuntime, adProtectionRuntime, webhookGuardRuntime, serverStructureGuardRuntime
}: RegisterDiscordEventsDeps): void {
  const effectiveRole = role ?? "all";
  const runsSchedulers = roleRunsSchedulers(effectiveRole);
  const runsInteractions = roleRunsInteractions(effectiveRole);

  client.once("ready", async () => {
    const userTag = client.user?.tag || "unknown";
    logger("INFO", "DISCORD", `Conectat ca ${userTag} (rol: ${effectiveRole})`);
    if (runsInteractions) {
      try {
        await commands.registerSlashCommands(String(env.DISCORD_TOKEN || ""), String(env.DISCORD_CLIENT_ID || ""));
      } catch (err) {
        logger("ERROR", "DISCORD", "Esec inregistrare slash commands", errorMessage(err));
        adminAlert("slash:register-failed", "Slash commands nu au putut fi inregistrate", errorMessage(err)).catch(() => null);
      }
      if (moderationLifecycleRuntime) {
        try {
          await moderationLifecycleRuntime.cleanupExpired();
        } catch (err) {
          metrics.security.runtimeErrored();
          logger("ERROR", "MODERATION_LIFECYCLE", "Curatarea sanctiunilor expirate a esuat", errorDetail(err));
          adminAlert("moderation:cleanup-failed", "Curatarea sanctiunilor expirate a esuat", errorMessage(err)).catch(() => null);
        }
      }
    }
    if (runsSchedulers) {
      try {
        startHousekeeping?.();
      } catch (err) {
        logger("ERROR", "BOOT", "startHousekeeping a esuat in handler-ul ready", errorDetail(err));
        adminAlert("boot:housekeeping", "Housekeeping nu a pornit", errorMessage(err)).catch(() => null);
      }
      try {
        scheduleNextCron?.();
      } catch (err) {
        logger("ERROR", "BOOT", "scheduleNextCron a esuat in handler-ul ready", errorDetail(err));
        adminAlert("boot:cron", "Cron-ul nu a putut fi programat", errorMessage(err)).catch(() => null);
      }
      if (startOutboxWorker) {
        try {
          startOutboxWorker();
        } catch (err) {
          logger("ERROR", "BOOT", "startOutboxWorker a esuat in handler-ul ready", errorDetail(err));
          adminAlert("boot:outbox", "Worker-ul outbox nu a putut porni", errorMessage(err)).catch(() => null);
        }
      }
    }
  });

  if (runsInteractions) {
    client.on("interactionCreate", async (interaction) => {
      const commandName = interaction.isChatInputCommand?.() === true && typeof interaction.commandName === "string"
        ? interaction.commandName
        : "";
      const startedAt = Date.now();
      try {
        const reqId = crypto.randomBytes(6).toString("hex");
        await requestContext.run({ requestId: reqId }, async () => {
          await commands.handleInteraction(interaction, games);
        });
      } catch (err) {
        if (commandName) metrics.command.errored(commandName);
        logger("ERROR", "INTERACTION", "Eroare top-level la interactionCreate", errorDetail(err));
        await replyInteractionError(interaction);
      } finally {
        if (commandName) {
          metrics.command.ran(commandName, Date.now() - startedAt);
        }
      }
    });

    const onboarding = createGuildOnboarding({ logger, canSendEmbeds: commands.canSendEmbeds, errorMessage });
    client.on("guildCreate", (guild: LifecycleDiscordGuild) => { onboarding.handleGuildCreate(guild).catch(() => null); });
    if (securityRuntime) {
      const reportSecurityFailure = (event: string, guildId: string | undefined, err: unknown): void => {
        metrics.security.runtimeErrored();
        logger("ERROR", "SECURITY_RUNTIME", `${event} a esuat`, errorDetail(err));
        adminAlert(`security:${event}`, `Protectia ${event} a esuat`, errorMessage(err), guildId).catch(() => null);
      };
      client.on("guildMemberAdd", (member: LifecycleDiscordGuildMember) => {
        securityRuntime.handleGuildMemberAdd(member).catch(err => reportSecurityFailure("guild-member-add", member.guild?.id, err));
      });
      client.on("messageCreate", (message: LifecycleDiscordMessage) => {
        securityRuntime.handleMessageCreate(message).catch(err => reportSecurityFailure("message-create", message.guild?.id, err));
      });
      client.on("channelDelete", (channel: LifecycleDiscordDeletedChannel) => {
        securityRuntime.handleChannelDelete(channel).catch(err => reportSecurityFailure("channel-delete", channel.guild?.id, err));
      });
    }
    if (permissionDelegationRuntime) {
      client.on("roleUpdate", (previous: LifecycleDiscordRole, next?: LifecycleDiscordRole) => {
        if (!next) return;
        permissionDelegationRuntime.handleRoleUpdate(previous, next).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "PERMISSION_DELEGATION", "roleUpdate a esuat", errorDetail(err));
          adminAlert("security:role-update", "Protectia rolurilor a esuat", errorMessage(err), next.guild?.id).catch(() => null);
        });
      });
      client.on("guildMemberUpdate", (previous: LifecycleDiscordGuildMember, next?: LifecycleDiscordGuildMember) => {
        if (!next) return;
        permissionDelegationRuntime.handleGuildMemberUpdate(previous, next).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "PERMISSION_DELEGATION", "guildMemberUpdate a esuat", errorDetail(err));
          adminAlert("security:member-role-update", "Protectia rolurilor membrilor a esuat", errorMessage(err), next.guild?.id).catch(() => null);
        });
      });
      client.on("roleCreate", (role: LifecycleDiscordRole) => {
        permissionDelegationRuntime.handleRoleCreate(role).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "PERMISSION_DELEGATION", "roleCreate a esuat", errorDetail(err));
          adminAlert("security:role-create", "Protectia rolurilor noi a esuat", errorMessage(err), role.guild?.id).catch(() => null);
        });
      });
      client.on("channelUpdate", (previous: LifecycleDiscordDeletedChannel, next?: LifecycleDiscordDeletedChannel) => {
        if (!next) return;
        permissionDelegationRuntime.handleChannelUpdate(previous, next).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "PERMISSION_DELEGATION", "channelUpdate a esuat", errorDetail(err));
          adminAlert("security:channel-update", "Protectia overwrite-urilor de canal a esuat", errorMessage(err), next.guild?.id ?? undefined).catch(() => null);
        });
      });
      client.on("webhookUpdate", (channel: LifecycleDiscordDeletedChannel) => {
        permissionDelegationRuntime.handleWebhookUpdate(channel).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "PERMISSION_DELEGATION", "webhookUpdate a esuat", errorDetail(err));
          adminAlert("security:webhook-update", "Monitorizarea webhook-urilor a esuat", errorMessage(err), channel.guild?.id ?? undefined).catch(() => null);
        });
        webhookGuardRuntime?.handleWebhookUpdate(channel).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "WEBHOOK_GUARD", "protectia webhook-urilor a esuat", errorDetail(err));
          adminAlert("security:webhook-guard", "Protectia webhook-urilor a esuat", errorMessage(err), channel.guild?.id ?? undefined).catch(() => null);
        });
      });
    }
    if (moderationLifecycleRuntime) {
      client.on("guildMemberRemove", (member: LifecycleDiscordGuildMember) => {
        moderationLifecycleRuntime.handleGuildMemberRemove(member).catch(err => {
          metrics.security.runtimeErrored();
          logger("ERROR", "MODERATION_LIFECYCLE", "guildMemberRemove a esuat", errorDetail(err));
          adminAlert("moderation:member-cleanup", "Curatarea sanctiunilor membrului a esuat", errorMessage(err), member.guild?.id).catch(() => null);
        });
      });
    }
    if (adProtectionRuntime) {
      client.on("messageCreate", (message: LifecycleDiscordMessage) => {
        const guildId = message.guild?.id;
        const authorId = message.author?.id;
        if (!guildId || !authorId || message.author?.bot === true) return;
        const attachments = (message as {
          attachments?: { size?: number; first?: () => { url?: string; name?: string; size?: number } | undefined }
        }).attachments;
        const firstAttachment = attachments?.first?.() ?? null;
        adProtectionRuntime.handleMessage({
          guildId,
          authorId,
          authorTag: message.author?.tag ?? authorId,
          bot: false,
          channelId: message.channel?.id ?? null,
          content: message.content ?? "",
          attachmentUrl: firstAttachment?.url ?? null,
          attachmentName: firstAttachment?.name ?? null,
          attachmentSize: firstAttachment?.size ?? null,
          attachmentCount: attachments?.size ?? 0,
          deleteMessage: async () => (message as { delete?: () => Promise<unknown> }).delete?.()
        }).catch(err => logger("ERROR", "AD_PROTECTION", "Verificarea reclamelor a esuat", errorDetail(err)));
      });
    }
    if (antiRaidRuntime) {
      const watchRaid = (event: string, guildId: string | undefined, run: () => Promise<unknown>): void => {
        if (!guildId) return;
        run().catch(err => logger("ERROR", "ANTI_RAID", `Observarea ${event} a esuat`, errorDetail(err)));
      };
      const structureEvent = (event: StructureChangeKind, rawGuild: unknown, rawResourceId: unknown): void => {
        const guild = rawGuild as { id?: string } | null | undefined;
        const resourceId = typeof rawResourceId === "string" ? rawResourceId : null;
        if (!guild?.id || !resourceId) return;
        const guildId = guild.id;
        const adapted = serverStructureGuardRuntime
          ? adaptStructureGuardGuild(rawGuild as AdaptableStructureGuild)
          : null;
        if (serverStructureGuardRuntime && adapted) {
          watchRaid(event, guildId, () => serverStructureGuardRuntime.handleStructureChange(adapted, event, resourceId));
          return;
        }
        const surface = event === "roleCreate" || event === "roleDelete" ? "role" : "channel";
        const action = event === "channelDelete" || event === "roleDelete" ? "delete" : "create";
        watchRaid(event, guildId, () => antiRaidRuntime.observeStructureChange(guildId, resourceId, null, { surface, action }));
      };
      client.on("messageCreate", (message: LifecycleDiscordMessage) => {
        const guildId = message.guild?.id;
        const actorId = message.author?.id;
        if (!guildId || !actorId) return;
        const mentions = message.mentions;
        const mentionCount = (mentions?.users?.size ?? 0)
          + (mentions?.roles?.size ?? 0)
          + (mentions?.everyone === true ? 1 : 0);
        watchRaid("messageCreate", guildId, () => antiRaidRuntime.observeMessage(guildId, {
          actorId,
          bot: message.author?.bot === true,
          channelId: message.channel?.id ?? null,
          content: message.content ?? "",
          mentionCount,
          attachmentCount: (message as { attachments?: { size?: number } }).attachments?.size ?? 0,
          at: Date.now()
        }));
      });
      client.on("guildMemberAdd", (member: LifecycleDiscordGuildMember) => {
        const guildId = member.guild?.id;
        const memberId = member.user?.id ?? member.id;
        if (!guildId || !memberId || member.user?.bot !== true) return;
        watchRaid("guildMemberAdd", guildId, () => antiRaidRuntime.observeBotJoin(guildId, memberId));
      });
      client.on("channelCreate", (channel: LifecycleDiscordDeletedChannel) => structureEvent("channelCreate", channel?.guild, channel?.id));
      client.on("channelDelete", (channel: LifecycleDiscordDeletedChannel) => structureEvent("channelDelete", channel?.guild, channel?.id));
      client.on("roleCreate", (role: LifecycleDiscordRole) => structureEvent("roleCreate", role?.guild, role?.id));
      client.on("roleDelete", (role: LifecycleDiscordRole) => structureEvent("roleDelete", role?.guild, role?.id));
    }
    if (protectedResourceRuntime) {
      const guardResource = (event: string, rawGuild: unknown, rawResourceId: unknown, current: unknown): void => {
        const guild = rawGuild as AdaptableGuild | null | undefined;
        const resourceId = typeof rawResourceId === "string" ? rawResourceId : null;
        if (!guild || typeof guild.id !== "string" || !resourceId) return;
        const guildId = guild.id;
        const adapted = adaptProtectedResourceGuild(guild);
        const run = current === null
          ? protectedResourceRuntime.handleResourceDelete(adapted, resourceId)
          : protectedResourceRuntime.handleResourceUpdate(adapted, resourceId, current as ResourceLike);
        run.catch(err => {
          logger("ERROR", "PROTECTED_RESOURCE", `Protectia resursei la ${event} a esuat`, errorDetail(err));
          adminAlert("security:protected-resource", "Protectia resurselor critice a esuat", errorMessage(err), guildId).catch(() => null);
        });
      };
      client.on("channelUpdate", (_previous: LifecycleDiscordDeletedChannel, next?: LifecycleDiscordDeletedChannel) => {
        if (next) guardResource("channelUpdate", next.guild, next.id, next);
      });
      client.on("channelDelete", (channel: LifecycleDiscordDeletedChannel) => {
        guardResource("channelDelete", channel?.guild, channel?.id, null);
      });
      client.on("roleUpdate", (_previous: LifecycleDiscordRole, next?: LifecycleDiscordRole) => {
        if (next) guardResource("roleUpdate", next.guild, next.id, next);
      });
      client.on("roleDelete", (role: LifecycleDiscordRole) => {
        guardResource("roleDelete", role?.guild, role?.id, null);
      });
    }
    if (serverEventLogRuntime) {
      const logServerEvent = (event: string, promise: Promise<void>): void => {
        promise.catch(err => logger("ERROR", "SERVER_EVENT_LOG", `Inregistrarea evenimentului ${event} a esuat`, errorDetail(err)));
      };
      client.on("guildMemberAdd", (member: LifecycleDiscordGuildMember) => logServerEvent("member-add", serverEventLogRuntime.handleGuildMemberAdd(member)));
      client.on("channelCreate", (channel: LifecycleDiscordDeletedChannel) => logServerEvent("channel-create", serverEventLogRuntime.handleChannelCreate(channel)));
      client.on("channelDelete", (channel: LifecycleDiscordDeletedChannel) => logServerEvent("channel-delete", serverEventLogRuntime.handleChannelDelete(channel)));
      client.on("roleCreate", (role: LifecycleDiscordRole) => logServerEvent("role-create", serverEventLogRuntime.handleRoleCreate(role)));
      client.on("roleDelete", (role: LifecycleDiscordRole) => logServerEvent("role-delete", serverEventLogRuntime.handleRoleDelete(role)));
      client.on("guildBanAdd", (ban: LifecycleDiscordGuildMember) => logServerEvent("ban-add", serverEventLogRuntime.handleGuildBanAdd(ban)));
      client.on("guildBanRemove", (ban: LifecycleDiscordGuildMember) => logServerEvent("ban-remove", serverEventLogRuntime.handleGuildBanRemove(ban)));
      client.on("guildMemberRemove", (member: LifecycleDiscordGuildMember) => logServerEvent("member-remove", serverEventLogRuntime.handleGuildMemberRemove(member)));
      client.on("guildMemberUpdate", (previous: LifecycleDiscordGuildMember, next?: LifecycleDiscordGuildMember) => {
        if (!next) return;
        logServerEvent("member-timeout", serverEventLogRuntime.handleGuildMemberTimeout(previous, next));
      });
    }
  }

  client.on("error", (err) => logger("ERROR", "DISCORD", "Eroare client Discord", errorMessage(err)));
  client.on("warn", (msg) => logger("WARN", "DISCORD", msg));
  client.on("shardError", (err) => logger("ERROR", "DISCORD", "Shard error", errorMessage(err)));
}

function registerMongoEvents({ mongoose, logger, errorMessage }: RegisterMongoEventsDeps): void {
  mongoose.connection.on("connected", () => logger("INFO", "DB", "Conectat la MongoDB"));
  mongoose.connection.on("disconnected", () => logger("WARN", "DB", "Deconectat de la MongoDB"));
  mongoose.connection.on("error", (err) => logger("ERROR", "DB", "Eroare MongoDB", errorMessage(err)));
  mongoose.connection.on("reconnected", () => logger("INFO", "DB", "Reconectat la MongoDB"));
}

export { registerDiscordEvents, registerMongoEvents };
export type { RegisterDiscordEventsDeps, RegisterMongoEventsDeps };
