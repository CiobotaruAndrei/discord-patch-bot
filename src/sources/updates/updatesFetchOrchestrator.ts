import type { AbortPredicate } from "../../types.js";
import type { GameConfig } from "../../config/configTypes.js";
import type { FetchResult } from "../sourceTypes.js";
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
      for (const entry of runResult.errors) {
        const globalIdx = items[entry.index]?.idx;
        if (globalIdx !== undefined) errorsByIndex.set(globalIdx, entry.error);
      }
    }));

    const completed: FetchResult[] = [];
    for (let i = 0; i < list.length; i++) {
      const fetched = results[i];
      if (fetched) {
        completed.push(fetched);
        continue;
      }
      const concurrentErr = errorsByIndex.get(i);
      completed.push({ game: list[i], latest: null, error: concurrentErr !== undefined ? errorMessage(concurrentErr) : "abort" });
    }
    return completed;
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
