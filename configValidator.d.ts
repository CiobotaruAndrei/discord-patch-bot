import type { z, ZodIssue } from "zod";
import type { BotConfig, GameConfig, GameType } from "./types";

export const ALLOWED_GAME_TYPES: ReadonlySet<GameType>;
export const ALLOWED_CHECK_INTERVAL_MINUTES: ReadonlySet<number>;

export const GameSchema: z.ZodType<GameConfig>;
export const ConfigSchema: z.ZodType<BotConfig>;

export function validateConfig(config: unknown, source?: string): BotConfig;

export interface ConfigValidationError extends Error {
  issues?: ZodIssue[];
}
