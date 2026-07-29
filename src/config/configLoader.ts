import * as path from "path";
import { readFileSync } from "node:fs";
import { validateConfig } from "./configValidator.js";
import { createGameCatalog } from "./gameCatalog.js";
import { errorMessage } from "../shared/errors.js";
import type { BotConfig, ConfigLoadResult, NormalizedGameConfig } from "./configTypes.js";

function resolveConfigPath(configPath: string): string {
  return path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
}

function loadConfig(configPath = process.env.CONFIG_PATH || "./config.json"): ConfigLoadResult {
  const resolvedPath = resolveConfigPath(configPath);
  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(readFileSync(resolvedPath, "utf8"));
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

  const games: NormalizedGameConfig[] = Array.isArray(config.games) ? config.games : [];
  if (games.length === 0) {
    console.error(`[BOOT] Config-ul de la "${configPath}" nu contine un array "games" cu jocuri.`);
    process.exit(1);
  }

  return { config, games, catalog: createGameCatalog(games), configPath };
}

export { loadConfig, resolveConfigPath };
