import { z, type ZodIssue } from "zod";
import type { BotConfig } from "./configTypes.js";
import { GameSchema, GameTypeSchema } from "./gameConfigSchemas.js";
import { GameCatalogSchema } from "./gameCatalogSchema.js";

const ALLOWED_CHECK_INTERVAL_MINUTES = new Set<number>([10, 15, 30, 60]);
const ALLOWED_GAME_TYPES = new Set<string>(GameTypeSchema.options);

const ConfigSchema = z.object({
  checkIntervalMinutes: z.number().positive().optional(),
  games: GameCatalogSchema
}).superRefine((config, refinement) => {
  if (config.checkIntervalMinutes !== undefined && !ALLOWED_CHECK_INTERVAL_MINUTES.has(config.checkIntervalMinutes)) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checkIntervalMinutes"],
      message: "Intervalul trebuie sa fie una dintre valorile suportate: 10, 15, 30 sau 60 minute"
    });
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
