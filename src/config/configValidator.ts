import { z, type ZodIssue } from "zod";
import type { BotConfig } from "../types";

type IssuePath = Array<string | number>;
type SeenSearchTerm = {
  label: string;
  path: IssuePath;
  ownerIndex: number;
};
type ConfigParseError = { error: { issues: ZodIssue[] } };

const ALLOWED_GAME_TYPES = new Set<string>([
  "steam",
  "minecraft",
  "epic_games",
  "roblox",
  "listing_based",
  "nvidia",
  "amd",
  "intel"
]);

const ALLOWED_CHECK_INTERVAL_MINUTES = new Set<number>([10, 15, 30, 60]);

const GameSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.string().optional(),
  appId: z.string().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string().min(1)).optional(),
  thumbnail: z.string().url().optional(),
  url: z.string().url().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  upCRD: z.number().int().min(0).max(1).optional()
}).passthrough();

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().positive().optional(),
  games: z.array(GameSchema).min(1)
}).superRefine((config, ctx) => {
  if (config.checkIntervalMinutes !== undefined && !ALLOWED_CHECK_INTERVAL_MINUTES.has(config.checkIntervalMinutes)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkIntervalMinutes"],
      message: "Intervalul trebuie sa fie una dintre valorile suportate: 10, 15, 30 sau 60 minute"
    });
  }

  const seenKeys = new Set<string>();
  const seenSearchTerms = new Map<string, SeenSearchTerm>();

  function addSearchTerm(term: unknown, path: IssuePath, label: string, ownerIndex: number): void {
    const normalized = String(term || "").toLowerCase().trim();
    if (!normalized) return;

    const existing = seenSearchTerms.get(normalized);
    if (existing && existing.ownerIndex !== ownerIndex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${label} duplicat cu ${existing.label}: ${String(term)}`
      });
      return;
    }

    if (!existing) seenSearchTerms.set(normalized, { label, path, ownerIndex });
  }

  for (let i = 0; i < config.games.length; i++) {
    const game = config.games[i];
    const type = game.type || "steam";
    const path: IssuePath = ["games", i];

    if (seenKeys.has(game.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "key"],
        message: `Cheie duplicata in config: ${game.key}`
      });
    }
    seenKeys.add(game.key);
    addSearchTerm(game.key, [...path, "key"], `cheia jocului ${game.name}`, i);
    addSearchTerm(game.name, [...path, "name"], `numele jocului ${game.key}`, i);

    if (Array.isArray(game.aliases)) {
      const localAliases = new Set<string>();
      for (let aliasIndex = 0; aliasIndex < game.aliases.length; aliasIndex++) {
        const alias = game.aliases[aliasIndex];
        const normalizedAlias = String(alias).toLowerCase().trim();
        if (localAliases.has(normalizedAlias)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, "aliases", aliasIndex],
            message: `Alias duplicat pentru ${game.key}: ${alias}`
          });
        }
        localAliases.add(normalizedAlias);
        addSearchTerm(alias, [...path, "aliases", aliasIndex], `aliasul jocului ${game.key}`, i);
      }
    }

    if (!ALLOWED_GAME_TYPES.has(type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "type"],
        message: `Tip joc necunoscut: ${type}`
      });
    }

    if (type === "steam") {
      if (!game.appId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "appId"],
          message: "Jocurile Steam trebuie sa aiba appId"
        });
      } else if (!/^\d+$/.test(String(game.appId))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "appId"],
          message: "appId pentru Steam trebuie sa contina doar cifre"
        });
      }
    }

    if (type === "listing_based") {
      const hasListing = Boolean(game.listingUrl)
        || (Array.isArray(game.listingUrls) && game.listingUrls.length > 0);
      if (!hasListing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "listingUrls"],
          message: "Sursele listing_based trebuie sa aiba listingUrl sau listingUrls"
        });
      }
      if (Array.isArray(game.listingUrls)) {
        const uniqueUrls = new Set(game.listingUrls);
        if (uniqueUrls.size !== game.listingUrls.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...path, "listingUrls"],
            message: "listingUrls nu trebuie sa contina URL-uri duplicate"
          });
        }
      }
      if (!game.baseUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "baseUrl"],
          message: "Sursele listing_based trebuie sa aiba baseUrl"
        });
      }
    }

    if (type === "intel" && !game.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "url"],
        message: "Sursele Intel trebuie sa aiba url"
      });
    }

    if (game.upCRD !== undefined && type !== "nvidia") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "upCRD"],
        message: "upCRD este un camp legacy permis doar pentru sursele NVIDIA"
      });
    }

    if (game.articleHrefRegex) {
      try { new RegExp(game.articleHrefRegex); }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "articleHrefRegex"],
          message: `Regex invalid: ${message}`
        });
      }
    }
  }
});

function formatZodIssues(issues: ZodIssue[]): string {
  return issues.map(issue => {
    const location = issue.path.length ? issue.path.join(".") : "config";
    return `${location}: ${issue.message}`;
  }).join("\n");
}

function validateConfig(config: unknown, source = "config.json"): BotConfig {
  const result = ConfigSchema.safeParse(config);
  if (result.success) return result.data as BotConfig;

  const issues = (result as ConfigParseError).error.issues;
  const err = new Error(`Config invalid (${source}):\n${formatZodIssues(issues)}`) as Error & { issues?: ZodIssue[] };
  err.issues = issues;
  throw err;
}

export {
  validateConfig,
  ConfigSchema,
  GameSchema,
  ALLOWED_GAME_TYPES,
  ALLOWED_CHECK_INTERVAL_MINUTES
};
