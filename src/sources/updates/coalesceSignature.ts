import type { GameConfig, GameSourceFallback } from "../../types";

function fallbackSignature(fallback: GameSourceFallback): Record<string, unknown> {
  return {
    type: fallback.type ?? null,
    url: fallback.url ?? null,
    listingUrl: fallback.listingUrl ?? null,
    listingUrls: fallback.listingUrls ?? null,
    baseUrl: fallback.baseUrl ?? null
  };
}

function gameSignature(game: GameConfig): string {
  return JSON.stringify({
    key: game.key ?? null,
    type: game.type ?? null,
    url: game.url ?? null,
    appId: game.appId ?? null,
    listingUrl: game.listingUrl ?? null,
    listingUrls: game.listingUrls ?? null,
    baseUrl: game.baseUrl ?? null,
    articleHrefRegex: game.articleHrefRegex ?? null,
    requireKeywords: game.requireKeywords ?? null,
    upCRD: game.upCRD ?? null,
    fallbacks: Array.isArray(game.fallbacks) ? game.fallbacks.map(fallbackSignature) : null
  });
}

export function buildCoalesceSignature(games: ReadonlyArray<GameConfig>): string {
  return games.map(gameSignature).sort().join("|");
}
