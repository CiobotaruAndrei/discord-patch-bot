// @ts-check
"use strict";

const path = require("path");
const { validateConfig } = require("../config/configValidator");
const { errorMessage } = require("./errors");

/** @typedef {import("../types").BotConfig} BotConfig */
/** @typedef {import("../types").GameConfig} GameConfig */

function resolveConfigPath(configPath) {
  return path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
}

function loadConfig(configPath = process.env.CONFIG_PATH || "./config.json") {
  const resolvedPath = resolveConfigPath(configPath);
  /** @type {unknown} */
  let rawConfig;
  try {
    rawConfig = require(resolvedPath);
  } catch (err) {
    console.error(`[BOOT] Nu pot incarca config-ul de la calea "${configPath}": ${errorMessage(err)}`);
    console.error("[BOOT] Asigura-te ca fisierul exista si este JSON valid. Override cu env CONFIG_PATH.");
    process.exit(1);
  }

  /** @type {BotConfig} */
  let config;
  try {
    config = validateConfig(rawConfig, configPath);
  } catch (err) {
    console.error(`[BOOT] ${errorMessage(err)}`);
    process.exit(1);
  }

  /** @type {GameConfig[]} */
  const games = Array.isArray(config.games) ? config.games : [];
  if (games.length === 0) {
    console.error(`[BOOT] Config-ul de la "${configPath}" nu contine un array "games" cu jocuri.`);
    process.exit(1);
  }

  return { config, games, configPath };
}

module.exports = { loadConfig };
