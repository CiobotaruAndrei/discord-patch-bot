import { z, type ZodIssue } from "zod";
import type { BotConfig } from "./configTypes.js";
import {
  ALLOWED_GAME_TYPES,
  validateSteamSource,
  validateListingBasedSource,
  validateIntelSource,
  validateRssSource,
  validateEpicGamesSource,
  validateSourceFallbacks
} from "./sourceTypeValidators.js";

type IssuePath = Array<string | number>;
type SeenSearchTerm = {
  label: string;
  path: IssuePath;
  ownerIndex: number;
};
const ALLOWED_CHECK_INTERVAL_MINUTES = new Set<number>([10, 15, 30, 60]);
const GameTypeSchema = z.enum(["steam", "minecraft", "epic_games", "roblox", "listing_based", "nvidia", "amd", "intel", "rss"]);

const FallbackSchema = z.object({
  type: GameTypeSchema,
  url: z.string().url().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional()
}).strict();

const GameFields = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  appId: z.string().optional(),
  listingUrl: z.string().url().optional(),
  listingUrls: z.array(z.string().url()).optional(),
  baseUrl: z.string().url().optional(),
  articleHrefRegex: z.string().optional(),
  requireKeywords: z.array(z.string().min(1)).optional(),
  thumbnail: z.string().url().optional(),
  url: z.string().url().optional(),
  aliases: z.array(z.string().min(1)).optional(),
  upCRD: z.union([z.literal(0), z.literal(1)]).optional(),
  fallbacks: z.array(FallbackSchema).optional()
}).strict();

const GameSchema = z.preprocess(
  value => value && typeof value === "object" && !("type" in value)
    ? { ...value, type: "steam" }
    : value,
  z.discriminatedUnion("type", [
    GameFields.extend({ type: z.literal("steam") }),
    GameFields.extend({ type: z.literal("minecraft") }),
    GameFields.extend({ type: z.literal("epic_games") }),
    GameFields.extend({ type: z.literal("roblox") }),
    GameFields.extend({ type: z.literal("listing_based") }),
    GameFields.extend({ type: z.literal("nvidia") }),
    GameFields.extend({ type: z.literal("amd") }),
    GameFields.extend({ type: z.literal("intel") }),
    GameFields.extend({ type: z.literal("rss") })
  ])
);

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().positive().optional(),
  games: z.array(GameSchema).min(1)
}).superRefine((config, refinement) => {
  if (config.checkIntervalMinutes !== undefined && !ALLOWED_CHECK_INTERVAL_MINUTES.has(config.checkIntervalMinutes)) {
    refinement.addIssue({
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
      refinement.addIssue({
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
      refinement.addIssue({
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
          refinement.addIssue({
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
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "type"],
        message: `Tip joc necunoscut: ${type}`
      });
    }

    if (type === "steam") validateSteamSource(game, path, refinement);
    if (type === "listing_based") validateListingBasedSource(game, path, refinement);
    if (type === "intel") validateIntelSource(game, path, refinement);
    if (type === "rss") validateRssSource(game, path, refinement);
    validateSourceFallbacks(game, path, refinement);
    if (type === "epic_games") validateEpicGamesSource(game, path, refinement);

    if (game.upCRD !== undefined && type !== "nvidia") {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, "upCRD"],
        message: "upCRD este un camp legacy permis doar pentru sursele NVIDIA"
      });
    }

    if (game.articleHrefRegex) {
      try { new RegExp(game.articleHrefRegex); }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        refinement.addIssue({
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

export class ConfigValidationError extends Error {
  readonly issues: ZodIssue[];

  constructor(source: string, issues: ZodIssue[]) {
    super(`Config invalid (${source}):\n${formatZodIssues(issues)}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

function validateConfig(config: unknown, source = "config.json"): BotConfig {
  const result = ConfigSchema.safeParse(config);
  if (result.success) return result.data;
  throw new ConfigValidationError(source, result.error.issues);
}

export {
  validateConfig,
  ConfigSchema,
  GameSchema,
  ALLOWED_GAME_TYPES,
  ALLOWED_CHECK_INTERVAL_MINUTES
};
