import type { BotRole, GameConfig, RuntimeEnv } from "../../types.js";
import type { BotMetrics } from "../health/metricsTypes.js";
import type { LifecycleDiscordChannel, LifecycleDiscordDeletedChannel, LifecycleDiscordGuild, LifecycleDiscordGuildMember, LifecycleDiscordInteraction, LifecycleDiscordMessage, LifecycleDiscordRole, LifecycleEventClient } from "./lifecycleContracts.js";
import { createGuildOnboarding } from "./guildOnboarding.js";
import { roleRunsSchedulers, roleRunsInteractions } from "../../shared/botRole.js";

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
  metrics: BotMetrics;
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
  securityRuntime?: {
    handleGuildMemberAdd(member: LifecycleDiscordGuildMember): Promise<void>;
    handleMessageCreate(message: LifecycleDiscordMessage): Promise<void>;
    handleChannelDelete(channel: LifecycleDiscordDeletedChannel): Promise<void>;
  };
  permissionDelegationRuntime?: {
    handleRoleUpdate(previous: LifecycleDiscordRole, next: LifecycleDiscordRole): Promise<void>;
    handleGuildMemberUpdate(previous: LifecycleDiscordGuildMember, next: LifecycleDiscordGuildMember): Promise<void>;
    handleRoleCreate(role: LifecycleDiscordRole): Promise<void>;
    handleChannelUpdate(previous: LifecycleDiscordDeletedChannel, next: LifecycleDiscordDeletedChannel): Promise<void>;
    handleWebhookUpdate(channel: LifecycleDiscordDeletedChannel): Promise<void>;
  };
  moderationLifecycleRuntime?: {
    cleanupExpired(): Promise<void>;
    handleGuildMemberRemove(member: LifecycleDiscordGuildMember): Promise<void>;
  };
  serverEventLogRuntime?: {
    handleGuildMemberAdd(member: LifecycleDiscordGuildMember): Promise<void>;
    handleChannelCreate(channel: LifecycleDiscordDeletedChannel): Promise<void>;
    handleChannelDelete(channel: LifecycleDiscordDeletedChannel): Promise<void>;
    handleRoleCreate(role: LifecycleDiscordRole): Promise<void>;
    handleRoleDelete(role: LifecycleDiscordRole): Promise<void>;
    handleGuildBanAdd(ban: LifecycleDiscordGuildMember): Promise<void>;
    handleGuildBanRemove(ban: LifecycleDiscordGuildMember): Promise<void>;
    handleGuildMemberRemove(member: LifecycleDiscordGuildMember): Promise<void>;
  };
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
  permissionDelegationRuntime, moderationLifecycleRuntime, serverEventLogRuntime
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
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
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
        if (commandName) metrics.commandErrors[commandName] = (metrics.commandErrors[commandName] || 0) + 1;
        logger("ERROR", "INTERACTION", "Eroare top-level la interactionCreate", errorDetail(err));
        await replyInteractionError(interaction);
      } finally {
        if (commandName) {
          metrics.commandRuns[commandName] = (metrics.commandRuns[commandName] || 0) + 1;
          metrics.commandDurationMsTotal[commandName] = (metrics.commandDurationMsTotal[commandName] || 0) + (Date.now() - startedAt);
        }
      }
    });

    const onboarding = createGuildOnboarding({ logger, canSendEmbeds: commands.canSendEmbeds, errorMessage });
    client.on("guildCreate", (guild: LifecycleDiscordGuild) => { onboarding.handleGuildCreate(guild).catch(() => null); });
    if (securityRuntime) {
      const reportSecurityFailure = (event: string, guildId: string | undefined, err: unknown): void => {
        metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
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
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
          logger("ERROR", "PERMISSION_DELEGATION", "roleUpdate a esuat", errorDetail(err));
          adminAlert("security:role-update", "Protectia rolurilor a esuat", errorMessage(err), next.guild?.id).catch(() => null);
        });
      });
      client.on("guildMemberUpdate", (previous: LifecycleDiscordGuildMember, next?: LifecycleDiscordGuildMember) => {
        if (!next) return;
        permissionDelegationRuntime.handleGuildMemberUpdate(previous, next).catch(err => {
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
          logger("ERROR", "PERMISSION_DELEGATION", "guildMemberUpdate a esuat", errorDetail(err));
          adminAlert("security:member-role-update", "Protectia rolurilor membrilor a esuat", errorMessage(err), next.guild?.id).catch(() => null);
        });
      });
      client.on("roleCreate", (role: LifecycleDiscordRole) => {
        permissionDelegationRuntime.handleRoleCreate(role).catch(err => {
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
          logger("ERROR", "PERMISSION_DELEGATION", "roleCreate a esuat", errorDetail(err));
          adminAlert("security:role-create", "Protectia rolurilor noi a esuat", errorMessage(err), role.guild?.id).catch(() => null);
        });
      });
      client.on("channelUpdate", (previous: LifecycleDiscordDeletedChannel, next?: LifecycleDiscordDeletedChannel) => {
        if (!next) return;
        permissionDelegationRuntime.handleChannelUpdate(previous, next).catch(err => {
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
          logger("ERROR", "PERMISSION_DELEGATION", "channelUpdate a esuat", errorDetail(err));
          adminAlert("security:channel-update", "Protectia overwrite-urilor de canal a esuat", errorMessage(err), next.guild?.id ?? undefined).catch(() => null);
        });
      });
      client.on("webhookUpdate", (channel: LifecycleDiscordDeletedChannel) => {
        permissionDelegationRuntime.handleWebhookUpdate(channel).catch(err => {
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
          logger("ERROR", "PERMISSION_DELEGATION", "webhookUpdate a esuat", errorDetail(err));
          adminAlert("security:webhook-update", "Monitorizarea webhook-urilor a esuat", errorMessage(err), channel.guild?.id ?? undefined).catch(() => null);
        });
      });
    }
    if (moderationLifecycleRuntime) {
      client.on("guildMemberRemove", (member: LifecycleDiscordGuildMember) => {
        moderationLifecycleRuntime.handleGuildMemberRemove(member).catch(err => {
          metrics.securityRuntimeErrors = (metrics.securityRuntimeErrors ?? 0) + 1;
          logger("ERROR", "MODERATION_LIFECYCLE", "guildMemberRemove a esuat", errorDetail(err));
          adminAlert("moderation:member-cleanup", "Curatarea sanctiunilor membrului a esuat", errorMessage(err), member.guild?.id).catch(() => null);
        });
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
