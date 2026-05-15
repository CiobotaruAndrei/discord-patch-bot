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
  upCRD: z.number().optional()
}).passthrough();

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().positive().optional(),
  games: z.array(GameSchema).min(1)
}).superRefine((config, ctx) => {
  const seenKeys = new Set();

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

    if (!ALLOWED_GAME_TYPES.has(type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "type"],
        message: `Tip joc necunoscut: ${type}`
      });
    }

    if (type === "steam" && !game.appId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "appId"],
        message: "Jocurile Steam trebuie sa aiba appId"
      });
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
  ALLOWED_GAME_TYPES
};
