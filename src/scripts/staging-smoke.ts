type SmokeLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface StagingSmokeDeps {
  logger: SmokeLogger;
  connectMongo: () => Promise<void>;
  isMongoReady: () => boolean;
  runMigrations: (logger: SmokeLogger) => Promise<{ applied: number[]; skipped: number }>;
  loginDiscord: () => Promise<void>;
  isDiscordReady: () => boolean;
  registerGuildCommands: (guildId: string) => Promise<void>;
  fetchOneSource: () => Promise<{ ok: boolean; detail: string }>;
  sendTestMessage: (channelId: string, content: string) => Promise<void>;
  devGuildId?: string;
  testChannelId?: string;
}

export interface SmokeStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeResult {
  ok: boolean;
  steps: SmokeStep[];
}

export async function runStagingSmoke(deps: StagingSmokeDeps): Promise<SmokeResult> {
  const steps: SmokeStep[] = [];

  async function run(name: string, fn: () => Promise<string>): Promise<boolean> {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail });
      deps.logger("INFO", "SMOKE", `OK: ${name}`, detail);
      return true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      steps.push({ name, ok: false, detail });
      deps.logger("ERROR", "SMOKE", `FAIL: ${name}`, detail);
      return false;
    }
  }

  if (!await run("mongo-connect", async () => {
    await deps.connectMongo();
    if (!deps.isMongoReady()) throw new Error("Mongo nu este ready dupa connect");
    return "conectat";
  })) return { ok: false, steps };

  if (!await run("migrations", async () => {
    const result = await deps.runMigrations(deps.logger);
    return `applied=${result.applied.length} skipped=${result.skipped}`;
  })) return { ok: false, steps };

  if (!await run("discord-login", async () => {
    await deps.loginDiscord();
    if (!deps.isDiscordReady()) throw new Error("Clientul Discord nu este ready dupa login");
    return "logat";
  })) return { ok: false, steps };

  if (deps.devGuildId && !await run("register-guild-commands", async () => {
    await deps.registerGuildCommands(deps.devGuildId as string);
    return `guild ${deps.devGuildId}`;
  })) return { ok: false, steps };

  if (!await run("fetch-source", async () => {
    const result = await deps.fetchOneSource();
    if (!result.ok) throw new Error(result.detail);
    return result.detail;
  })) return { ok: false, steps };

  if (deps.testChannelId && !await run("send-test-message", async () => {
    await deps.sendTestMessage(deps.testChannelId as string, "Staging smoke OK");
    return `channel ${deps.testChannelId}`;
  })) return { ok: false, steps };

  return { ok: true, steps };
}

interface SteamFetchResult {
  latest: { title?: unknown } | null;
  game: { key: string };
}

interface SendableChannel {
  send: (content: string) => Promise<unknown>;
}

if (require.main === module) {
  void (async () => {
    const mongoose = require("mongoose") as typeof import("mongoose");
    const { Client, GatewayIntentBits, REST, Routes } = require("discord.js") as typeof import("discord.js");
    const mongoContext = require("../infra/mongo/mongoContext") as {
      logger: SmokeLogger;
      env: { MONGO_URI: string; MONGO_MAX_POOL_SIZE: number; DISCORD_TOKEN: string; DISCORD_CLIENT_ID: string };
      runMigrations: (logger: SmokeLogger) => Promise<{ applied: number[]; skipped: number }>;
    };
    const commands = require("../features/command-registry/commandRegistry") as {
      buildSlashCommandDefinitions: () => unknown[];
    };
    const scrapers = require("../sources/sourceRegistry") as {
      getLatestForAllGames: (games: unknown[]) => Promise<SteamFetchResult[]>;
    };

    const { logger, env } = mongoContext;
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    const result = await runStagingSmoke({
      logger,
      connectMongo: async () => {
        await mongoose.connect(env.MONGO_URI, { maxPoolSize: env.MONGO_MAX_POOL_SIZE });
      },
      isMongoReady: () => mongoose.connection.readyState === 1,
      runMigrations: mongoContext.runMigrations,
      loginDiscord: async () => { await client.login(env.DISCORD_TOKEN); },
      isDiscordReady: () => client.isReady(),
      registerGuildCommands: async (guildId: string) => {
        const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
        await rest.put(
          Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId),
          { body: commands.buildSlashCommandDefinitions() }
        );
      },
      fetchOneSource: async () => {
        const results = await scrapers.getLatestForAllGames([
          { key: "cs2", name: "Counter-Strike 2", type: "steam", appId: 730 }
        ]);
        const first = results[0];
        if (first && first.latest) return { ok: true, detail: `cs2 -> ${String(first.latest.title || "update")}` };
        return { ok: false, detail: "Steam nu a returnat un update valid pentru cs2" };
      },
      sendTestMessage: async (channelId: string, content: string) => {
        const channel = await client.channels.fetch(channelId) as unknown as SendableChannel | null;
        if (!channel || typeof channel.send !== "function") {
          throw new Error(`Canalul ${channelId} nu este un canal in care se poate trimite`);
        }
        await channel.send(content);
      },
      devGuildId: process.env.DISCORD_DEV_GUILD_ID || undefined,
      testChannelId: process.env.DISCORD_TEST_CHANNEL_ID || undefined
    });

    logger("INFO", "SMOKE", result.ok ? "Staging smoke PASSED" : "Staging smoke FAILED",
      result.steps.map(step => `${step.ok ? "ok" : "FAIL"}:${step.name}`).join(", "));

    try { client.destroy(); } catch {  }
    try { await mongoose.disconnect(); } catch {  }
    process.exit(result.ok ? 0 : 1);
  })();
}
