import type { UpdatesApi } from "../sourceApis.js";
import { applyFallbackSource, isGoodSteamArticleUrl, isLikelyPatchNote, extractDateScore, scoreCandidate, absoluteUrl, sourceConcurrencyGroup } from "./updateHelpers.js";
import type { UpdatesDeps } from "./updatesContracts.js";
import { createUpdatesSourceDispatch } from "./updatesSourceDispatch.js";
import { createUpdatesCircuitBreaker } from "./updatesCircuitBreaker.js";
import { createUpdatesFetchOrchestrator } from "./updatesFetchOrchestrator.js";

function createUpdates(d: UpdatesDeps): UpdatesApi {
  const deps = { ...d };

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

const updatesSourceModule = {
  sourceConcurrencyGroup,
  createUpdates
};

export default updatesSourceModule;
