import * as http from "http";
import type { IncomingMessage, Server } from "http";
import type {
  BotMetrics,
  CommandCacheSizes,
  CronController,
  CronHealthSnapshot,
  LoggerFunction,
  RateLimiter,
  RuntimeEnv
} from "../../types.js";
import { renderPrometheusMetrics } from "./metricsRegistry.js";
import { errorMessage } from "../../shared/errors.js";

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

type HttpServerEnv = Pick<RuntimeEnv, "METRICS_PUBLIC" | "METRICS_TOKEN" | "isProd">;

interface CreateHttpServerDeps {
  mongoose: MongooseLike;
  crypto: CryptoLike;
  env: HttpServerEnv;
  client: DiscordClientLike;
  metrics: BotMetrics;
  logger: LoggerFunction;
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
  mongoose, crypto, env, client, metrics, logger, commands,
  getGuildCacheSize, scrapers, activeLocks, rateLimiter, cronController = null
}: CreateHttpServerDeps): Server {
  function checkMetricsAuth(req: IncomingMessage): boolean {

    if (env.METRICS_PUBLIC && !env.isProd) return true;

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
      const body = renderPrometheusMetrics({
        metrics,
        cacheSizes: commands.getCacheSizes(),
        guildCacheSize: getGuildCacheSize(),
        enrichedDealsCacheSize: scrapers.getEnrichedCacheSize(),
        rateLimitMapSize: rateLimiter.size,
        activeLocksSize: activeLocks.size
      });
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    } catch (err) {
      metrics.httpHandlerErrors++;
      logger("ERROR", "HTTP", `Handler HTTP a aruncat o eroare la ${req.method} ${req.url}`, errorMessage(err));
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
export type { CreateHttpServerDeps };
