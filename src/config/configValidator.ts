import { z, type ZodIssue } from "zod";
import type { BotConfig } from "./configTypes.js";
import { GameSchema, GameTypeSchema } from "./gameConfigSchemas.js";

type IssuePath = Array<string | number>;
type SeenSearchTerm = {
  label: string;
  path: IssuePath;
  ownerIndex: number;
};

const ALLOWED_CHECK_INTERVAL_MINUTES = new Set<number>([10, 15, 30, 60]);
const ALLOWED_GAME_TYPES = new Set<string>(GameTypeSchema.options);

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

  function addSearchTerm(term: string, path: IssuePath, label: string, ownerIndex: number): void {
    const normalized = term.toLowerCase().trim();
    if (!normalized) return;
    const existing = seenSearchTerms.get(normalized);
    if (existing && existing.ownerIndex !== ownerIndex) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path, message: `${label} duplicat cu ${existing.label}: ${term}` });
      return;
    }
    if (!existing) seenSearchTerms.set(normalized, { label, path, ownerIndex });
  }

  for (let i = 0; i < config.games.length; i++) {
    const game = config.games[i];
    const path: IssuePath = ["games", i];
    if (seenKeys.has(game.key)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "key"], message: `Cheie duplicata in config: ${game.key}` });
    }
    seenKeys.add(game.key);
    addSearchTerm(game.key, [...path, "key"], `cheia jocului ${game.name}`, i);
    addSearchTerm(game.name, [...path, "name"], `numele jocului ${game.key}`, i);

    const localAliases = new Set<string>();
    for (let aliasIndex = 0; aliasIndex < (game.aliases?.length ?? 0); aliasIndex++) {
      const alias = game.aliases?.[aliasIndex] ?? "";
      const normalizedAlias = alias.toLowerCase().trim();
      if (localAliases.has(normalizedAlias)) {
        refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "aliases", aliasIndex], message: `Alias duplicat pentru ${game.key}: ${alias}` });
      }
      localAliases.add(normalizedAlias);
      addSearchTerm(alias, [...path, "aliases", aliasIndex], `aliasul jocului ${game.key}`, i);
    }

    if (game.articleHrefRegex) {
      try { new RegExp(game.articleHrefRegex); }
      catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        refinement.addIssue({ code: z.ZodIssueCode.custom, path: [...path, "articleHrefRegex"], message: `Regex invalid: ${message}` });
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
