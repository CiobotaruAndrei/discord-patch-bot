import type { GameConfig, NormalizedUpdate } from "../../types";
import { errorMessage } from "../../shared/errors";
import { applyFallbackSource } from "./updateHelpers";
import { createSteamUpdates } from "./steamUpdates";
import { createListingUpdates } from "./listingUpdates";
import { createDriverUpdates } from "./driverUpdates";
import { createPlatformUpdates } from "./platformUpdates";
import type { UpdatesDeps } from "./updatesContracts";

export function createUpdatesSourceDispatch(deps: UpdatesDeps) {
  const { fetchSteamUpdate } = createSteamUpdates(deps);
  const { fetchListingBasedUpdate } = createListingUpdates(deps);
  const { fetchAmdUpdate, fetchIntelUpdate, fetchNvidiaUpdate } = createDriverUpdates(deps);
  const { fetchFortniteUpdate, fetchMinecraftUpdate, fetchRobloxUpdate, fetchRssUpdate } = createPlatformUpdates(deps);

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

  return {
    fetchSteamUpdate,
    fetchListingBasedUpdate,
    fetchFortniteUpdate,
    fetchMinecraftUpdate,
    fetchRobloxUpdate,
    fetchAmdUpdate,
    fetchIntelUpdate,
    fetchNvidiaUpdate,
    fetchGameUpdateForSource,
    fetchGameUpdate
  };
}
