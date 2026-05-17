import * as http from "http";
import type { IncomingMessage, Server } from "http";
import type {
  BotMetrics,
  CommandCacheSizes,
  CronController,
  CronHealthSnapshot,
  RateLimiter,
  RuntimeEnv
} from "../../types";

interface MongooseLike {
  connection: { readyState: number };
}

interface CryptoLike {
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
}

interface DiscordClientLike {
  isReady(): boolean;
}

interface CommandsLike {
  getCacheSizes(): CommandCacheSizes;
}

interface ScrapersLike {
  getEnrichedCacheSize(): number;
}

interface SizedCollectionLike {
  size: number;
}

interface HealthBody {
  status: "ok" | "degraded";
  mongo: number;
  discord: "ready" | "not-ready";
  uptimeMs: number;
  cronHealth?: CronHealthSnapshot;
}

interface CreateHttpServerDeps {
  mongoose: MongooseLike;
  crypto: CryptoLike;
  env: RuntimeEnv;
  client: DiscordClientLike;
  metrics: BotMetrics;
  commands: CommandsLike;
  getGuildCacheSize: () => number;
  scrapers: ScrapersLike;
  activeLocks: SizedCollectionLike;
  rateLimiter: RateLimiter;
  cronController?: CronController | null;
}

function timingSafeEqualStr(crypto: CryptoLike, a: unknown, b: unknown): boolean {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  try { return crypto.timingSafeEqual(bufA, bufB); } catch { return false; }
}

function createHttpServer({
  mongoose, crypto, env, client, metrics, commands,
  getGuildCacheSize, scrapers, activeLocks, rateLimiter, cronController = null
}: CreateHttpServerDeps): Server {
  function checkMetricsAuth(req: IncomingMessage): boolean {
    if (!env.isProd && !env.METRICS_TOKEN) return true;
    if (env.METRICS_PUBLIC && !env.METRICS_TOKEN) return true;
    if (!env.METRICS_TOKEN) return false;
    const auth = req.headers["authorization"] || "";
    const expected = `Bearer ${env.METRICS_TOKEN}`;
    return timingSafeEqualStr(crypto, auth, expected);
  }

  return http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/healthz" || req.url === "/metrics") {
      if (!rateLimiter.check(req)) {
        res.writeHead(429, {
          "Content-Type": "text/plain",
          "Retry-After": rateLimiter.retryAfterSeconds.toString()
        });
        res.end("Too Many Requests");
        return;
      }
    }

    if (req.url === "/health" || req.url === "/healthz") {
      const ok = mongoose.connection.readyState === 1 && client.isReady();
      const body: HealthBody = {
        status: ok ? "ok" : "degraded",
        mongo: mongoose.connection.readyState,
        discord: client.isReady() ? "ready" : "not-ready",
        uptimeMs: Date.now() - metrics.startedAt
      };
      if (typeof cronController?.getHealthSnapshot === "function") {
        body.cronHealth = cronController.getHealthSnapshot();
      }
      res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.url === "/metrics") {
      if (!checkMetricsAuth(req)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      const cacheSizes = commands.getCacheSizes();
      const lines = [
        `# HELP bot_uptime_seconds Bot uptime`,
        `# TYPE bot_uptime_seconds gauge`,
        `bot_uptime_seconds ${Math.floor((Date.now() - metrics.startedAt) / 1000)}`,
        `# HELP bot_fetch_success Fetch reusite`,
        `# TYPE bot_fetch_success counter`,
        `bot_fetch_success ${metrics.fetchSuccess}`,
        `# HELP bot_fetch_fail Fetch esuate`,
        `# TYPE bot_fetch_fail counter`,
        `bot_fetch_fail ${metrics.fetchFail}`,
        `# HELP bot_http_retries HTTP retries`,
        `# TYPE bot_http_retries counter`,
        `bot_http_retries ${metrics.httpRetries}`,
        `# HELP bot_rate_limit_hits Rate limit hits (upstream)`,
        `# TYPE bot_rate_limit_hits counter`,
        `bot_rate_limit_hits ${metrics.rateLimitHits}`,
        `# HELP bot_cron_runs Cron runs`,
        `# TYPE bot_cron_runs counter`,
        `bot_cron_runs ${metrics.cronRuns}`,
        `# HELP bot_cron_errors Cron errors`,
        `# TYPE bot_cron_errors counter`,
        `bot_cron_errors ${metrics.cronErrors}`,
        `# HELP bot_cron_skipped_due_to_lock Cron skipped`,
        `# TYPE bot_cron_skipped_due_to_lock counter`,
        `bot_cron_skipped_due_to_lock ${metrics.cronSkippedDueToLock}`,
        `# HELP bot_cron_aborted Cron aborted`,
        `# TYPE bot_cron_aborted counter`,
        `bot_cron_aborted ${metrics.cronAborted}`,
        `# HELP bot_cron_skipped_due_to_health Cron skipped by global health backoff`,
        `# TYPE bot_cron_skipped_due_to_health counter`,
        `bot_cron_skipped_due_to_health ${metrics.cronSkippedDueToHealth || 0}`,
        `# HELP bot_http_rate_limit_drops HTTP requests blocked by local rate limiter`,
        `# TYPE bot_http_rate_limit_drops counter`,
        `bot_http_rate_limit_drops ${metrics.httpRateLimitDrops}`,
        `# HELP bot_cache_single Cache single size`,
        `# TYPE bot_cache_single gauge`,
        `bot_cache_single ${cacheSizes.single}`,
        `# HELP bot_cache_dlc Cache DLC size`,
        `# TYPE bot_cache_dlc gauge`,
        `bot_cache_dlc ${cacheSizes.dlc}`,
        `# HELP bot_cache_updates_valid Updates cache valid`,
        `# TYPE bot_cache_updates_valid gauge`,
        `bot_cache_updates_valid ${cacheSizes.updatesValid ? 1 : 0}`,
        `# HELP bot_cache_deals_currencies_valid Deals cache currencies count`,
        `# TYPE bot_cache_deals_currencies_valid gauge`,
        `bot_cache_deals_currencies_valid ${cacheSizes.dealsCurrenciesValid}`,
        `# HELP bot_cache_user_cooldowns User cooldowns size`,
        `# TYPE bot_cache_user_cooldowns gauge`,
        `bot_cache_user_cooldowns ${cacheSizes.userCooldowns}`,
        `# HELP bot_cache_guild_settings Guild settings cache size`,
        `# TYPE bot_cache_guild_settings gauge`,
        `bot_cache_guild_settings ${getGuildCacheSize()}`,
        `# HELP bot_cache_enriched_deals_size Enriched deals cache size`,
        `# TYPE bot_cache_enriched_deals_size gauge`,
        `bot_cache_enriched_deals_size ${scrapers.getEnrichedCacheSize()}`,
        `# HELP bot_http_rate_limit_map_size Local HTTP rate limit map size`,
        `# TYPE bot_http_rate_limit_map_size gauge`,
        `bot_http_rate_limit_map_size ${rateLimiter.size}`,
        `# HELP bot_active_locks Active distributed locks`,
        `# TYPE bot_active_locks gauge`,
        `bot_active_locks ${activeLocks.size}`
      ];
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(lines.join("\n") + "\n");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });
}

export { createHttpServer, timingSafeEqualStr };
