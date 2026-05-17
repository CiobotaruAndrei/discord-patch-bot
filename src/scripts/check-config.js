// @ts-check
"use strict";

const path = require("path");
const { validateConfig } = require("../config/configValidator");

const configPath = process.env.CONFIG_PATH
  ? path.resolve(process.cwd(), process.env.CONFIG_PATH)
  : path.resolve(__dirname, "..", "config.json");
const config = require(configPath);
const validated = validateConfig(config, configPath);

console.log(`Config OK: ${validated.games.length} entries from ${configPath}`);
