import { z } from "zod";

export type SourceIssuePath = Array<string | number>;

export interface SourceRefinement {
  addIssue(issue: { code: typeof z.ZodIssueCode.custom; path: SourceIssuePath; message: string }): void;
}

export interface SourceFallbackInput {
  type: string;
  url?: string;
  listingUrl?: string;
  listingUrls?: string[];
}

export interface SourceGameInput {
  key: string;
  url?: string;
  appId?: string | number;
  listingUrl?: string;
  listingUrls?: string[];
  baseUrl?: string;
  fallbacks?: SourceFallbackInput[];
}

export const ALLOWED_GAME_TYPES = new Set<string>([
  "steam",
  "minecraft",
  "epic_games",
  "roblox",
  "listing_based",
  "nvidia",
  "amd",
  "intel",
  "rss"
]);

function requireListing(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement, message: string): void {
  const hasListing = Boolean(game.listingUrl)
    || (Array.isArray(game.listingUrls) && game.listingUrls.length > 0);
  if (!hasListing) {
    refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "listingUrls"], message });
  }
  if (Array.isArray(game.listingUrls)) {
    const uniqueUrls = new Set(game.listingUrls);
    if (uniqueUrls.size !== game.listingUrls.length) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "listingUrls"],
        message: "listingUrls nu trebuie sa contina URL-uri duplicate"
      });
    }
  }
}

export function validateSteamSource(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement): void {
  if (!game.appId) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "appId"],
      message: "Jocurile Steam trebuie sa aiba appId"
    });
  } else if (!/^\d+$/.test(String(game.appId))) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "appId"],
      message: "appId pentru Steam trebuie sa contina doar cifre"
    });
  }
}

export function validateListingBasedSource(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement): void {
  requireListing(game, path, refinement, "Sursele listing_based trebuie sa aiba listingUrl sau listingUrls");
  if (!game.baseUrl) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "baseUrl"],
      message: "Sursele listing_based trebuie sa aiba baseUrl"
    });
  }
}

export function validateIntelSource(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement): void {
  if (!game.url) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "url"],
      message: "Sursele Intel trebuie sa aiba url"
    });
  }
}

export function validateRssSource(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement): void {
  if (!game.url) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "url"],
      message: "Sursele rss trebuie sa aiba url (URL-ul feed-ului RSS/Atom)"
    });
  }
}

export function validateEpicGamesSource(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement): void {
  if (game.key === "fortnite") return;
  requireListing(game, path, refinement, "Sursele epic_games (non-fortnite) trebuie sa aiba listingUrl sau listingUrls");
  if (!game.baseUrl) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...path, "baseUrl"],
      message: "Sursele epic_games (non-fortnite) trebuie sa aiba baseUrl"
    });
  }
}

export function validateSourceFallbacks(game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement): void {
  const fallbacks = Array.isArray(game.fallbacks) ? game.fallbacks : [];
  fallbacks.forEach((fallback, fbIndex) => {
    const fbPath = [...path, "fallbacks", fbIndex];
    if (!ALLOWED_GAME_TYPES.has(fallback.type)) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...fbPath, "type"],
        message: `Tip fallback necunoscut: ${fallback.type}`
      });
    }
    if ((fallback.type === "rss" || fallback.type === "intel") && !fallback.url && !game.url) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...fbPath, "url"],
        message: `Fallback-ul de tip ${fallback.type} trebuie sa aiba url`
      });
    }
    if ((fallback.type === "listing_based" || fallback.type === "epic_games") && !fallback.listingUrl && !fallback.listingUrls && !game.listingUrl && !game.listingUrls) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...fbPath, "listingUrl"],
        message: `Fallback-ul de tip ${fallback.type} trebuie sa aiba listingUrl sau listingUrls`
      });
    }
  });
}

export const SOURCE_TYPE_VALIDATORS: Record<string, (game: SourceGameInput, path: SourceIssuePath, refinement: SourceRefinement) => void> = {
  steam: validateSteamSource,
  listing_based: validateListingBasedSource,
  intel: validateIntelSource,
  rss: validateRssSource,
  epic_games: validateEpicGamesSource
};
