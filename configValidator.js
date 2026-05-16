"use strict";

const { z } = require("zod");

const ALLOWED_GAME_TYPES = new Set([
  "steam",
  "minecraft",
  "epic_games",
  "roblox",
  "listing_based",
  "nvidia",
  "amd",
  "intel"
]);

const ALLOWED_CHECK_INTERVAL_MINUTES = new Set([10, 15, 30, 60]);

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

  const seenKeys = new Set();
  const seenSearchTerms = new Map();

  function addSearchTerm(term, path, label) {
    const normalized = String(term || "").toLowerCase().trim();
    if (!normalized) return;
    const existing = seenSearchTerms.get(normalized);
    if (existing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `${label} duplicat cu ${existing.label}: ${term}`
      });
      return;
    }
    seenSearchTerms.set(normalized, { label, path });
  }

  for (let i = 0; i < config.games.length; i++) {
    const game = config.games[i];
    const type = game.type || "steam";
    const path = ["games", i];

    if (seenKeys.has(game.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "key"],
        message: `Cheie duplicata in config: ${game.key}`
      });
    }
    seenKeys.add(game.key);
    addSearchTerm(game.key, [...path, "key"], `cheia jocului ${game.name}`);
    addSearchTerm(game.name, [...path, "name"], `numele jocului ${game.key}`);

    if (Array.isArray(game.aliases)) {
      const localAliases = new Set();
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
        addSearchTerm(alias, [...path, "aliases", aliasIndex], `aliasul jocului ${game.key}`);
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
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, "articleHrefRegex"],
          message: `Regex invalid: ${err.message}`
        });
      }
    }
  }
});

function formatZodIssues(issues) {
  return issues.map(issue => {
    const location = issue.path.length ? issue.path.join(".") : "config";
    return `${location}: ${issue.message}`;
  }).join("\n");
}

function validateConfig(config, source = "config.json") {
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    const err = new Error(`Config invalid (${source}):\n${formatZodIssues(result.error.issues)}`);
    err.issues = result.error.issues;
    throw err;
  }
  return result.data;
}

module.exports = {
  validateConfig,
  ConfigSchema,
  GameSchema,
  ALLOWED_GAME_TYPES,
  ALLOWED_CHECK_INTERVAL_MINUTES
};
