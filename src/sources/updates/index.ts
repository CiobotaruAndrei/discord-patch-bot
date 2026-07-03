import type { UpdatesApi } from "../sourceApis";
import { applyFallbackSource, isGoodSteamArticleUrl, isLikelyPatchNote, extractDateScore, scoreCandidate, absoluteUrl, sourceConcurrencyGroup } from "./updateHelpers";
import type { UpdatesContext, UpdatesDeps } from "./updatesContracts";
import { createUpdatesSourceDispatch } from "./updatesSourceDispatch";
import { createUpdatesCircuitBreaker } from "./updatesCircuitBreaker";
import { createUpdatesFetchOrchestrator } from "./updatesFetchOrchestrator";

function createUpdates(d: UpdatesDeps): UpdatesApi {
  const deps = d;

  const dispatch = createUpdatesSourceDispatch(deps);
  const { executeFetchWithCircuitBreaker } = createUpdatesCircuitBreaker(deps, dispatch.fetchGameUpdate);
  const { getLatestForAllGames } = createUpdatesFetchOrchestrator(deps, executeFetchWithCircuitBreaker);

  return {
    absoluteUrl,
    isGoodSteamArticleUrl,
    extractDateScore,
    scoreCandidate,
    isLikelyPatchNote,
    fetchSteamUpdate: dispatch.fetchSteamUpdate,
    fetchListingBasedUpdate: dispatch.fetchListingBasedUpdate,
    fetchFortniteUpdate: dispatch.fetchFortniteUpdate,
    fetchAmdUpdate: dispatch.fetchAmdUpdate,
    fetchIntelUpdate: dispatch.fetchIntelUpdate,
    fetchMinecraftUpdate: dispatch.fetchMinecraftUpdate,
    fetchRobloxUpdate: dispatch.fetchRobloxUpdate,
    fetchNvidiaUpdate: dispatch.fetchNvidiaUpdate,
    fetchGameUpdate: dispatch.fetchGameUpdate,
    applyFallbackSource,
    executeFetchWithCircuitBreaker,
    sourceConcurrencyGroup,
    getLatestForAllGames
  };
}

function buildUpdatesFrom(target: UpdatesContext) {
  return createUpdates({
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
  });
}

function attachUpdates(target: UpdatesContext): void {
  Object.assign(target, buildUpdatesFrom(target));
}

attachUpdates.buildFrom = buildUpdatesFrom;
attachUpdates.sourceConcurrencyGroup = sourceConcurrencyGroup;
attachUpdates.createUpdates = createUpdates;

export = attachUpdates;
