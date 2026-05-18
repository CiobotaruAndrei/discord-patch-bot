// @ts-check
"use strict";

const path = require("path");
const { validateConfig } = require("../config/configValidator");

function defaultConfigPath(): string {
  if (path.basename(path.dirname(__dirname)) === "dist") {
    return path.resolve(__dirname, "..", "..", "config.json");
  }
  return path.resolve(__dirname, "..", "config.json");
}

const configPath = process.env.CONFIG_PATH
  ? path.resolve(process.cwd(), process.env.CONFIG_PATH)
  : defaultConfigPath();
const config = require(configPath);
const validated = validateConfig(config, configPath);

console.log(`Config OK: ${validated.games.length} entries from ${configPath}`);

export {};
