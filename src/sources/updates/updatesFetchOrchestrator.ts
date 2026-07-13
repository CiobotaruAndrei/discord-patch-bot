import type { AbortPredicate, FetchResult, GameConfig } from "../../types.js";
import { errorMessage } from "../../shared/errors.js";
import { sourceConcurrencyGroup } from "./updateHelpers.js";
import { buildCoalesceSignature } from "./coalesceSignature.js";
import type { UpdatesDeps } from "./updatesContracts.js";

export function createUpdatesFetchOrchestrator(deps: UpdatesDeps, executeFetchWithCircuitBreaker: (game: GameConfig) => Promise<FetchResult>) {
  const inflightAllGames = new Map<string, Promise<FetchResult[]>>();

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
      .update(buildCoalesceSignature(games))
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

  return { concurrencyForGroup, getLatestForAllGames };
}
