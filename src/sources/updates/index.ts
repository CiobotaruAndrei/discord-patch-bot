import type { Model } from "mongoose";
import type { CheerioAPI } from "cheerio";
import type {
  AbortPredicate,
  BotMetrics,
  FetchResult,
  GameConfig,
  GameSourceFallback,
  HttpRequestOptions,
  LoggerFunction,
  NormalizedUpdate,
  PatchUpdate
} from "../../types";
import {
  classifyPatchNote,
  extractDateScore as rustExtractDateScore,
  isGoodSteamArticleUrl as rustIsGoodSteamArticleUrl,
  rankListingCandidates,
  scoreListingCandidate
} from "../../native/fuzzy";
import { errorMessage } from "../../shared/errors";
import type { UpdatesApi, ListingCandidate } from "../sourceApis";

import { applyFallbackSource, isGoodSteamArticleUrl, isLikelyPatchNote, extractDateScore, scoreCandidate, absoluteUrl, sourceConcurrencyGroup } from "./updateHelpers";
import type { HttpReq, RssParserLike, RunConcurrent, SchemaDriftErrorClass, TrackInflight, WithInflightTimeout } from "./updateHelpers";
import { createSteamUpdates } from "./steamUpdates";
import { createListingUpdates } from "./listingUpdates";
import { createDriverUpdates } from "./driverUpdates";
import { createPlatformUpdates } from "./platformUpdates";

interface CircuitBreakerDoc {
  _id: string;
  fails: number;
  cooldownUntil?: Date | string | null;
  alertSent?: boolean;
  schemaDriftFails: number;
  schemaDriftAlertSent?: boolean;
}

interface UpdatesDeps {
  rssParser: RssParserLike;
  CircuitBreakerModel: Model<CircuitBreakerDoc>;
  logger: LoggerFunction;
  adminAlert: (kind: string, title: string, body: string) => Promise<void>;
  runConcurrent: RunConcurrent;
  SchemaDriftError: SchemaDriftErrorClass;
  FETCH_CONCURRENCY: number;
  FETCH_CONCURRENCY_STEAM: number;
  FETCH_CONCURRENCY_EPIC: number;
  FETCH_CONCURRENCY_LISTING: number;
  FETCH_CONCURRENCY_DRIVER: number;
  CIRCUIT_BREAKER_FAIL_THRESHOLD: number;
  CIRCUIT_BREAKER_COOLDOWN_MS: number;
  CIRCUIT_BREAKER_JITTER_MS: number;
  SCHEMA_DRIFT_THRESHOLD: number;
  httpReq: HttpReq;
  conditionalGet: <T>(url: string, parse: (data: unknown) => T | Promise<T>, options?: HttpRequestOptions) => Promise<T>;
  fetchWithProxy: (targetUrl: string, options?: HttpRequestOptions) => Promise<string>;
  withInflightTimeout: WithInflightTimeout;
  trackInflight: TrackInflight;
  cleanText: (text: unknown) => string;
  stableUpdateId: (title: unknown, link: unknown) => string;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  crypto: typeof import("crypto");
  metricsRef: Pick<BotMetrics, "fetchSuccess" | "fetchFail">;
  executeFetchWithCircuitBreaker?: (game: GameConfig) => Promise<FetchResult>;
}

type UpdatesContext = UpdatesDeps & Record<string, unknown>;

function createUpdates(d: UpdatesDeps): UpdatesApi {
  const inflightAllGames = new Map<string, Promise<FetchResult[]>>();
  const deps = d;

  const { fetchSteamUpdate } = createSteamUpdates(deps);
  const { fetchListingBasedUpdate } = createListingUpdates(deps);
  const { fetchAmdUpdate, fetchIntelUpdate, fetchNvidiaUpdate } = createDriverUpdates(deps);
  const { fetchFortniteUpdate, fetchMinecraftUpdate, fetchRobloxUpdate, fetchRssUpdate } = createPlatformUpdates(deps);

  function concurrencyForGroup(group: string): number {
    const {
      FETCH_CONCURRENCY, FETCH_CONCURRENCY_STEAM, FETCH_CONCURRENCY_EPIC,
      FETCH_CONCURRENCY_LISTING, FETCH_CONCURRENCY_DRIVER
    } = deps;
    if (group === "steam") return FETCH_CONCURRENCY_STEAM;
    if (group === "epic") return FETCH_CONCURRENCY_EPIC;
    if (group === "listing") return FETCH_CONCURRENCY_LISTING;
    if (group === "driver") return FETCH_CONCURRENCY_DRIVER;
    return FETCH_CONCURRENCY;
  }

    async function fetchGameUpdateForSource(game: GameConfig): Promise<NormalizedUpdate> {
    const t = game.type;
    if (!t || t === "steam") return fetchSteamUpdate(game);
    if (t === "minecraft") return fetchMinecraftUpdate();
    if (t === "epic_games" && game.key === "fortnite") return fetchFortniteUpdate();
    if (t === "roblox") return fetchRobloxUpdate();
    if (t === "nvidia") return fetchNvidiaUpdate(game);
    if (t === "intel") return fetchIntelUpdate(game);
    if (t === "amd") return fetchAmdUpdate(game);
    if (t === "rss") return fetchRssUpdate(game);
    if (t === "listing_based" || t === "epic_games") return fetchListingBasedUpdate(game);
    throw new Error("Tip necunoscut.");
  }

  async function fetchGameUpdate(game: GameConfig): Promise<NormalizedUpdate> {
    try {
      return await fetchGameUpdateForSource(game);
    } catch (primaryErr) {
      const fallbacks = Array.isArray(game.fallbacks) ? game.fallbacks : [];
      const fallbackFailures: string[] = [];
      for (const fallback of fallbacks) {
        if (!fallback || !fallback.type) continue;
        try {
          const update = await fetchGameUpdateForSource(applyFallbackSource(game, fallback));
          deps.logger("INFO", "FALLBACK", `Sursa principala pentru ${game.key} a esuat; am folosit fallback '${fallback.type}'.`);
          return update;
        } catch (fallbackErr) {
          fallbackFailures.push(`${fallback.type}: ${errorMessage(fallbackErr)}`);
          deps.logger("WARN", "FALLBACK", `Sursa fallback '${fallback.type}' pentru ${game.key} a esuat`, errorMessage(fallbackErr));
        }
      }
      if (fallbackFailures.length) {
        const suffix = ` | fallback-uri esuate: ${fallbackFailures.join("; ")}`;
        if (primaryErr instanceof Error) {
          primaryErr.message = `${primaryErr.message}${suffix}`;
          throw primaryErr;
        }
        throw new Error(`${errorMessage(primaryErr)}${suffix}`);
      }
      throw primaryErr;
    }
  }

  async function executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult> {
    const {
      CircuitBreakerModel,
      CIRCUIT_BREAKER_FAIL_THRESHOLD,
      CIRCUIT_BREAKER_COOLDOWN_MS,
      CIRCUIT_BREAKER_JITTER_MS,
      SCHEMA_DRIFT_THRESHOLD,
      SchemaDriftError,
      adminAlert,
      metricsRef
    } = deps;
    let cb: CircuitBreakerDoc | null = null;
    try {
      cb = await CircuitBreakerModel.findOneAndUpdate(
        { _id: game.key },
        { $setOnInsert: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!cb) throw new Error(`Circuit breaker document lipsa pentru ${game.key}`);
    } catch (cbGetErr) {
      deps.logger("WARN", "CIRCUIT_BREAKER",
        `Eroare la citirea state-ului CB pentru ${game.key}, sar fetch-ul ciclului curent`,
        errorMessage(cbGetErr));
      metricsRef.fetchFail++;
      return { game, latest: null, error: errorMessage(cbGetErr) };
    }
    if (cb.cooldownUntil && new Date() < new Date(cb.cooldownUntil)) {
      return { game, latest: null, error: "Circuit Breaker Activ" };
    }
    try {
      const latest = await fetchGameUpdate(game);
      if (cb.fails > 0 || cb.cooldownUntil || cb.alertSent || cb.schemaDriftFails > 0 || cb.schemaDriftAlertSent) {
        await CircuitBreakerModel.updateOne(
          { _id: game.key },
          { $set: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } }
        );
      }
      metricsRef.fetchSuccess++;
      return { game, latest, error: null };
    } catch (error) {
      try {
        if (error instanceof SchemaDriftError) {
          const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
            { _id: game.key },
            { $inc: { schemaDriftFails: 1 } },
            { new: true, upsert: true }
          );
          if (updatedCb.schemaDriftFails >= SCHEMA_DRIFT_THRESHOLD
              && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
            const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
            await CircuitBreakerModel.updateOne(
              { _id: game.key },
              { $set: { cooldownUntil: new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter) } }
            );
            if (!updatedCb.schemaDriftAlertSent) {
              await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { schemaDriftAlertSent: true } });
              await adminAlert(
                `drift:${game.key}`,
                `Schema drift suspectat: ${game.name}`,
                `Sursa pentru \`${game.key}\` returnează HTTP OK dar 0 rezultate valide după ${updatedCb.schemaDriftFails} cicluri consecutive. Probabil selectorii CSS/HTML s-au schimbat.\nSursă: ${error.source}\nMesaj: ${error.message}\nCooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.`
              );
            }
          }
          metricsRef.fetchFail++;
          return { game, latest: null, error: error.message };
        }

        const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
          { _id: game.key },
          { $inc: { fails: 1 } },
          { new: true, upsert: true }
        );
        if (updatedCb.fails >= CIRCUIT_BREAKER_FAIL_THRESHOLD
            && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
          const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
          await CircuitBreakerModel.updateOne(
            { _id: game.key },
            { $set: { cooldownUntil: new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter) } }
          );
          if (!updatedCb.alertSent) {
            await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { alertSent: true } });
            await adminAlert(
              `cb:${game.key}`,
              `Circuit breaker activat: ${game.name}`,
              `Sursa pentru \`${game.key}\` a eșuat de ${updatedCb.fails} ori consecutiv. Cooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.\nUltima eroare: ${errorMessage(error)}`
            );
          }
        }
      } catch (bookkeepingErr) {
        deps.logger("WARN", "CIRCUIT_BREAKER",
          `Eroare la actualizarea state-ului circuit breaker pentru ${game.key}`,
          errorMessage(bookkeepingErr));
      }
      metricsRef.fetchFail++;
      return { game, latest: null, error: errorMessage(error) };
    }
  }

  async function _getLatestForAllGamesImpl(games: GameConfig[], shouldAbort?: AbortPredicate): Promise<FetchResult[]> {
    const { runConcurrent, logger } = deps;
    const exec = deps.executeFetchWithCircuitBreaker || executeFetchWithCircuitBreaker;
    const list = games.slice();
    const results = new Array<FetchResult | undefined>(list.length);

    const groups = new Map<string, Array<{ game: GameConfig; idx: number }>>();
    for (let idx = 0; idx < list.length; idx++) {
      const group = sourceConcurrencyGroup(list[idx]);
      const bucket = groups.get(group);
      if (bucket) bucket.push({ game: list[idx], idx });
      else groups.set(group, [{ game: list[idx], idx }]);
    }

    const errorsByIndex = new Map<number, unknown>();
    await Promise.all(Array.from(groups.entries()).map(async ([group, items]) => {
      const runResult = await runConcurrent(items, concurrencyForGroup(group), async (item) => {
        results[item.idx] = await exec(item.game);
      }, {
        shouldAbort,
        errorLogger: (item: { game: GameConfig }, err: unknown) => {
          logger("WARN", "FETCH_WORKER", `Eroare la procesarea ${item.game.key}`, errorMessage(err));
        }
      });
      if (runResult && Array.isArray((runResult as { errors?: unknown }).errors)) {
        for (const entry of ((runResult as { errors: Array<{ index: number; error: unknown }> }).errors)) {
          const globalIdx = items[entry.index]?.idx;
          if (globalIdx !== undefined) errorsByIndex.set(globalIdx, entry.error);
        }
      }
    }));

    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        const concurrentErr = errorsByIndex.get(i);
        const placeholderError = concurrentErr !== undefined
          ? errorMessage(concurrentErr)
          : "abort";
        results[i] = { game: list[i], latest: null, error: placeholderError };
      }
    }
    return results as FetchResult[];
  }

  async function getLatestForAllGames(games: GameConfig[], shouldAbort?: AbortPredicate): Promise<FetchResult[]> {
    const { crypto, logger, withInflightTimeout, trackInflight } = deps;
    const sourceModeBase = shouldAbort ? "cron" : "manual";
    const keysHash = crypto.createHash("sha1")
      .update(games.map(g => String(g.key)).sort().join(","))
      .digest("hex")
      .substring(0, 8);
    const contextKey = `${sourceModeBase}:${keysHash}`;
    const existing = inflightAllGames.get(contextKey);
    if (existing) {
      logger("INFO", "FETCH_COALESCE", `Refolosesc fetch-ul în curs (context=${contextKey})`);
      return existing;
    }
    const promise = withInflightTimeout(
      _getLatestForAllGamesImpl(games, shouldAbort),
      `getLatestForAllGames(${contextKey})`
    );
    trackInflight(inflightAllGames, contextKey, promise);
    return promise;
  }

  return {
      absoluteUrl,
      isGoodSteamArticleUrl,
      extractDateScore,
      scoreCandidate,
      isLikelyPatchNote,
      fetchSteamUpdate,
      fetchListingBasedUpdate,
      fetchFortniteUpdate,
      fetchAmdUpdate,
      fetchIntelUpdate,
      fetchMinecraftUpdate,
      fetchRobloxUpdate,
      fetchNvidiaUpdate,
      fetchGameUpdate,
      applyFallbackSource,
      executeFetchWithCircuitBreaker,
      sourceConcurrencyGroup,
      getLatestForAllGames
    };
}

function attachUpdates(target: UpdatesContext): void {
  Object.assign(target, createUpdates({
    rssParser: target.rssParser,
    CircuitBreakerModel: target.CircuitBreakerModel,
    logger: target.logger,
    adminAlert: target.adminAlert,
    runConcurrent: target.runConcurrent,
    SchemaDriftError: target.SchemaDriftError,
    FETCH_CONCURRENCY: target.FETCH_CONCURRENCY,
    FETCH_CONCURRENCY_STEAM: target.FETCH_CONCURRENCY_STEAM,
    FETCH_CONCURRENCY_EPIC: target.FETCH_CONCURRENCY_EPIC,
    FETCH_CONCURRENCY_LISTING: target.FETCH_CONCURRENCY_LISTING,
    FETCH_CONCURRENCY_DRIVER: target.FETCH_CONCURRENCY_DRIVER,
    CIRCUIT_BREAKER_FAIL_THRESHOLD: target.CIRCUIT_BREAKER_FAIL_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS: target.CIRCUIT_BREAKER_COOLDOWN_MS,
    CIRCUIT_BREAKER_JITTER_MS: target.CIRCUIT_BREAKER_JITTER_MS,
    SCHEMA_DRIFT_THRESHOLD: target.SCHEMA_DRIFT_THRESHOLD,
    httpReq: target.httpReq,
    conditionalGet: target.conditionalGet,
    fetchWithProxy: target.fetchWithProxy,
    withInflightTimeout: target.withInflightTimeout,
    trackInflight: target.trackInflight,
    cleanText: target.cleanText,
    stableUpdateId: target.stableUpdateId,
    normalizeUpdate: target.normalizeUpdate,
    safeCheerioLoad: target.safeCheerioLoad,
    crypto: target.crypto,
    metricsRef: target.metricsRef,
    executeFetchWithCircuitBreaker: target.executeFetchWithCircuitBreaker
  }));
}

attachUpdates.sourceConcurrencyGroup = sourceConcurrencyGroup;
attachUpdates.createUpdates = createUpdates;

export = attachUpdates;

