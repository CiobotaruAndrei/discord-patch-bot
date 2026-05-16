// @ts-check
"use strict";

const path = require("path");
const { validateConfig } = require("../configValidator");

const configPath = path.resolve(process.cwd(), process.env.CONFIG_PATH || "./config.json");
const config = require(configPath);
const validated = validateConfig(config, configPath);

console.log(`Config OK: ${validated.games.length} entries from ${configPath}`);
