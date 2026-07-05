import type { GameConfig, RuntimeEnv } from "../../types";
import type { BotMetrics } from "../health/metricsTypes";
import type { LifecycleDiscordChannel, LifecycleDiscordGuild, LifecycleDiscordInteraction, LifecycleEventClient } from "./lifecycleContracts";
import { createGuildOnboarding } from "./guildOnboarding";

type LifecycleLogger = (level: "INFO" | "WARN" | "ERROR", context: string, message: string, meta?: unknown) => void;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;

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
  startHousekeeping: () => void;
  scheduleNextCron: () => void;
  startOutboxWorker?: () => void;
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
  games, crypto, errorMessage, errorDetail, startHousekeeping, scheduleNextCron, startOutboxWorker
}: RegisterDiscordEventsDeps): void {
  client.once("ready", async () => {
    const userTag = client.user?.tag || "unknown";
    logger("INFO", "DISCORD", `Conectat ca ${userTag}`);
    try {
      await commands.registerSlashCommands(String(env.DISCORD_TOKEN || ""), String(env.DISCORD_CLIENT_ID || ""));
    } catch (err) {
      logger("ERROR", "DISCORD", "Esec inregistrare slash commands", errorMessage(err));
      adminAlert("slash:register-failed", "Slash commands nu au putut fi inregistrate", errorMessage(err)).catch(() => null);
    }
    try {
      startHousekeeping();
    } catch (err) {
      logger("ERROR", "BOOT", "startHousekeeping a esuat in handler-ul ready", errorDetail(err));
      adminAlert("boot:housekeeping", "Housekeeping nu a pornit", errorMessage(err)).catch(() => null);
    }
    try {
      scheduleNextCron();
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
  });

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
