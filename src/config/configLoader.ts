import * as path from "path";
import { validateConfig } from "./configValidator";
import { errorMessage } from "../shared/errors";
import type { BotConfig, ConfigLoadResult, GameConfig } from "../types";

function resolveConfigPath(configPath: string): string {
  return path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
}

function loadConfig(configPath = process.env.CONFIG_PATH || "./config.json"): ConfigLoadResult {
  const resolvedPath = resolveConfigPath(configPath);
  let rawConfig: unknown;
  try {
    rawConfig = require(resolvedPath);
  } catch (err) {
    console.error(`[BOOT] Nu pot incarca config-ul de la calea "${configPath}": ${errorMessage(err)}`);
    console.error("[BOOT] Asigura-te ca fisierul exista si este JSON valid. Override cu env CONFIG_PATH.");
    process.exit(1);
  }

  let config: BotConfig;
  try {
    config = validateConfig(rawConfig, configPath);
  } catch (err) {
    console.error(`[BOOT] ${errorMessage(err)}`);
    process.exit(1);
  }

  const games: GameConfig[] = Array.isArray(config.games) ? config.games : [];
  if (games.length === 0) {
    console.error(`[BOOT] Config-ul de la "${configPath}" nu contine un array "games" cu jocuri.`);
    process.exit(1);
  }

  return { config, games, configPath };
}

export { loadConfig, resolveConfigPath };
