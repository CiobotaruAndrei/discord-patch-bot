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

type PrometheusMetricType = "counter" | "gauge";

function timingSafeEqualStr(crypto: CryptoLike, a: unknown, b: unknown): boolean {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  try { return crypto.timingSafeEqual(bufA, bufB); } catch { return false; }
}

function pushMetric(
  lines: string[],
  seenNames: Set<string>,
  name: string,
  type: PrometheusMetricType,
  help: string,
  value: string | number
): void {
  if (seenNames.has(name)) return;
  seenNames.add(name);
  lines.push(
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`,
    `${name} ${value}`
  );
}

function createHttpServer({
  mongoose, crypto, env, client, metrics, commands,
  getGuildCacheSize, scrapers, activeLocks, rateLimiter, cronController = null
}: CreateHttpServerDeps): Server {
  function checkMetricsAuth(req: IncomingMessage): boolean {

    if (env.METRICS_PUBLIC) return true;

    if (!env.METRICS_TOKEN) return !env.isProd;
    const auth = req.headers["authorization"] || "";
    const expected = `Bearer ${env.METRICS_TOKEN}`;
    return timingSafeEqualStr(crypto, auth, expected);
  }

  return http.createServer((req, res) => {
    try {
    if (!rateLimiter.check(req)) {
      res.writeHead(429, {
        "Content-Type": "text/plain",
        "Retry-After": rateLimiter.retryAfterSeconds.toString()
      });
      res.end("Too Many Requests");
      return;
    }
    let pathname: string;
    try {
      pathname = new URL(req.url || "/", "http://localhost").pathname;
    } catch {

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    if (pathname === "/health" || pathname === "/healthz") {
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

    if (pathname === "/metrics") {
      if (!checkMetricsAuth(req)) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
      const cacheSizes = commands.getCacheSizes();
      const lines: string[] = [];
      const seenMetricNames = new Set<string>();
      pushMetric(lines, seenMetricNames, "bot_uptime_seconds", "gauge", "Bot uptime", Math.floor((Date.now() - metrics.startedAt) / 1000));
      pushMetric(lines, seenMetricNames, "bot_fetch_success", "counter", "Fetch reusite", metrics.fetchSuccess);
      pushMetric(lines, seenMetricNames, "bot_fetch_fail", "counter", "Fetch esuate", metrics.fetchFail);
      pushMetric(lines, seenMetricNames, "bot_http_retries", "counter", "HTTP retries", metrics.httpRetries);
      pushMetric(lines, seenMetricNames, "bot_rate_limit_hits", "counter", "Rate limit hits (upstream)", metrics.rateLimitHits);
      pushMetric(lines, seenMetricNames, "bot_cron_runs", "counter", "Cron runs", metrics.cronRuns);
      pushMetric(lines, seenMetricNames, "bot_cron_errors", "counter", "Cron errors", metrics.cronErrors);
      pushMetric(lines, seenMetricNames, "bot_cron_skipped_due_to_lock", "counter", "Cron skipped", metrics.cronSkippedDueToLock);
      pushMetric(lines, seenMetricNames, "bot_cron_aborted", "counter", "Cron aborted", metrics.cronAborted);
      pushMetric(lines, seenMetricNames, "bot_cron_skipped_due_to_health", "counter", "Cron skipped by global health backoff", metrics.cronSkippedDueToHealth || 0);
      pushMetric(lines, seenMetricNames, "bot_http_rate_limit_drops", "counter", "HTTP requests blocked by local rate limiter", metrics.httpRateLimitDrops);
      pushMetric(lines, seenMetricNames, "bot_cache_single", "gauge", "Cache single size", cacheSizes.single);
      pushMetric(lines, seenMetricNames, "bot_cache_dlc", "gauge", "Cache DLC size", cacheSizes.dlc);
      pushMetric(lines, seenMetricNames, "bot_cache_updates_valid", "gauge", "Updates cache valid", cacheSizes.updatesValid ? 1 : 0);
      pushMetric(lines, seenMetricNames, "bot_cache_deals_currencies_valid", "gauge", "Deals cache currencies count", cacheSizes.dealsCurrenciesValid);
      pushMetric(lines, seenMetricNames, "bot_cache_user_cooldowns", "gauge", "User cooldowns size", cacheSizes.userCooldowns);
      pushMetric(lines, seenMetricNames, "bot_cache_guild_settings", "gauge", "Guild settings cache size", getGuildCacheSize());
      pushMetric(lines, seenMetricNames, "bot_cache_enriched_deals_size", "gauge", "Enriched deals cache size", scrapers.getEnrichedCacheSize());
      pushMetric(lines, seenMetricNames, "bot_http_rate_limit_map_size", "gauge", "Local HTTP rate limit map size", rateLimiter.size);
      pushMetric(lines, seenMetricNames, "bot_active_locks", "gauge", "Active distributed locks", activeLocks.size);
      pushMetric(lines, seenMetricNames, "bot_outbox_sent", "counter", "Notification outbox jobs delivered", metrics.outboxSent);
      pushMetric(lines, seenMetricNames, "bot_outbox_retried", "counter", "Notification outbox jobs retried", metrics.outboxRetried);
      pushMetric(lines, seenMetricNames, "bot_outbox_dead_lettered", "counter", "Notification outbox jobs dead-lettered", metrics.outboxDeadLettered);
      pushMetric(lines, seenMetricNames, "bot_outbox_drains", "counter", "Notification outbox drain cycles", metrics.outboxDrains);
      pushMetric(lines, seenMetricNames, "bot_outbox_queue_depth", "gauge", "Notification outbox jobs currently queued", metrics.outboxQueueDepth);
      pushMetric(lines, seenMetricNames, "bot_outbox_delivery_ms_total", "counter", "Total ms spent delivering outbox jobs (with bot_outbox_sent gives avg latency)", metrics.outboxDeliveryMsTotal);
      pushMetric(lines, seenMetricNames, "bot_outbox_oldest_job_age_seconds", "gauge", "Age of the oldest queued outbox job", metrics.outboxOldestJobAgeSeconds);
      pushMetric(lines, seenMetricNames, "bot_outbox_lock_acquire_failures", "counter", "Outbox drain lock acquisition skipped (held by another instance)", metrics.outboxLockAcquireFailures);
      pushMetric(lines, seenMetricNames, "bot_outbox_recovery_duplicates_prevented", "counter", "Outbox recovery-verify duplicate sends prevented", metrics.outboxRecoveryDuplicates);
      pushMetric(lines, seenMetricNames, "bot_outbox_recovery_history_fetches", "counter", "Outbox recovery-verify channel history fetches", metrics.outboxRecoveryFetches);
      pushMetric(lines, seenMetricNames, "bot_outbox_recovery_verify_failures", "counter", "Outbox recovery-verify channel history fetch failures", metrics.outboxRecoveryFailures);
      pushMetric(lines, seenMetricNames, "bot_outbox_recovery_marker_missing", "counter", "Outbox recovery-verify fetched history but marker not found (re-sent)", metrics.outboxRecoveryMarkerMissing);
      pushMetric(lines, seenMetricNames, "bot_outbox_mark_sent_failures", "counter", "Outbox deliveries that could not be recorded in the sent-dedupe history", metrics.outboxMarkSentFailures);
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(lines.join("\n") + "\n");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    } catch {
      try {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
        }
        res.end("Internal Server Error");
      } catch {  }
    }
  });
}

export { createHttpServer, timingSafeEqualStr };
