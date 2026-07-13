import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __pathDirname } from "node:path";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);

"use strict";

import path from "path";
import { validateConfig } from "../config/configValidator.js";

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
