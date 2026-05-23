import type { GameConfig, RuntimeEnv } from "../../types";

type LifecycleLogger = (level: "INFO" | "WARN" | "ERROR", context: string, message: string, meta?: unknown) => void;
type ErrorFormatter = (err: unknown) => string;
type AdminAlert = (kind: string, title: string, body: string) => Promise<unknown>;

interface DiscordUserLike {
  id?: string;
  tag?: string;
}

interface DiscordClientLike {
  user?: DiscordUserLike | null;
  once(event: "ready", listener: () => unknown): unknown;
  on(event: "interactionCreate", listener: (interaction: unknown) => unknown): unknown;
  on(event: "error" | "shardError", listener: (err: unknown) => unknown): unknown;
  on(event: "warn", listener: (message: string) => unknown): unknown;
}

interface CommandsLike {
  registerSlashCommands(token: string, clientId: string): Promise<unknown>;
  handleInteraction(interaction: unknown, games: GameConfig[]): Promise<unknown> | unknown;
}

interface CryptoLike {
  randomBytes(size: number): Buffer;
}

interface RequestContextLike {
  run<T>(store: { requestId: string }, callback: () => T): T;
}

interface RegisterDiscordEventsDeps {
  client: DiscordClientLike;
  logger: LifecycleLogger;
  commands: CommandsLike;
  env: RuntimeEnv;
  adminAlert: AdminAlert;
  requestContext: RequestContextLike;
  games: GameConfig[];
  crypto: CryptoLike;
  errorMessage: ErrorFormatter;
  errorDetail: ErrorFormatter;
  startHousekeeping: () => void;
  scheduleNextCron: () => void;
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

function registerDiscordEvents({
  client, logger, commands, env, adminAlert, requestContext,
  games, crypto, errorMessage, errorDetail, startHousekeeping, scheduleNextCron
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
    // V11: wrap pentru ca un throw sincron din startHousekeeping / scheduleNextCron
    // sa nu bubble-uiasca la discord.js emitter ca unhandled — bot-ul ar fi
    // ramas logged-in dar fara housekeeping si fara cron. Acum log-am explicit
    // si trimitem alerta, ca operatorul sa vada ca bot-ul e in stare zombie.
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
  });

  client.on("interactionCreate", async (interaction) => {
    const reqId = crypto.randomBytes(6).toString("hex");
    await requestContext.run({ requestId: reqId }, async () => {
      try { await commands.handleInteraction(interaction, games); }
      catch (err) {
        logger("ERROR", "INTERACTION", "Eroare top-level la interactionCreate", errorDetail(err));
      }
    });
  });

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
