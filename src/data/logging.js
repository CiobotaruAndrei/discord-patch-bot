"use strict";

module.exports = (ctx) => {
  const { AsyncLocalStorage } = ctx;

const requestContext = new AsyncLocalStorage();

// -------------------------------------------------------------
// LOGGER cu requestId
// -------------------------------------------------------------
const LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const RAW_LOG_LEVEL = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const ACTIVE_LOG_LEVEL = LOG_LEVELS[RAW_LOG_LEVEL] ?? LOG_LEVELS.INFO;

const LOG_FORMAT = (process.env.LOG_FORMAT || "").toLowerCase();
const USE_JSON_LOGS = LOG_FORMAT === "json"
  || (LOG_FORMAT !== "text" && !process.stdout.isTTY);

function logger(level, context, message, meta = "") {
  const lvlKey = String(level || "INFO").toUpperCase();
  const lvl = LOG_LEVELS[lvlKey] ?? LOG_LEVELS.INFO;
  if (lvl < ACTIVE_LOG_LEVEL) return;

  const ts = new Date().toISOString();
  const ctx = requestContext.getStore();
  const reqId = ctx?.requestId;

  if (USE_JSON_LOGS) {
    const entry = { ts, level: lvlKey, context, message };
    if (reqId) entry.requestId = reqId;
    if (meta !== "" && meta !== null && meta !== undefined) {
      if (meta instanceof Error) {
        entry.meta = { message: meta.message, stack: meta.stack };
      } else if (typeof meta === "string") {
        entry.meta = meta;
      } else {
        try { entry.meta = JSON.parse(JSON.stringify(meta)); }
        catch { entry.meta = String(meta); }
      }
    }
    let line;
    try { line = JSON.stringify(entry); }
    catch { line = JSON.stringify({ ts, level: lvlKey, context, message, requestId: reqId, meta: "[unserializable]" }); }
    if (lvlKey === "ERROR") console.error(line);
    else if (lvlKey === "WARN") console.warn(line);
    else console.log(line);
    return;
  }
  let metaStr = "";
  if (meta) {
    try { metaStr = typeof meta === "string" ? meta : JSON.stringify(meta); }
    catch { metaStr = String(meta); }
  }
  const reqStr = reqId ? ` [req=${reqId}]` : "";
  const line = `[${ts}] [${lvlKey}] [${context}]${reqStr} ${message} ${metaStr}`;
  if (lvlKey === "ERROR") console.error(line);
  else if (lvlKey === "WARN") console.warn(line);
  else console.log(line);
}

// -------------------------------------------------------------
// PARSE ENV NUMBER
// -------------------------------------------------------------
function parseEnvNumber(name, defaultValue, { min = 0, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    logger("WARN", "ENV", `${name}="${raw}" nu este număr valid, folosesc default ${defaultValue}`);
    return defaultValue;
  }
  if (parsed < min) {
    logger("WARN", "ENV", `${name}=${parsed} sub minimul ${min}, folosesc minimul`);
    return min;
  }
  if (parsed > max) {
    logger("WARN", "ENV", `${name}=${parsed} peste maximul ${max}, folosesc maximul`);
    return max;
  }
  return parsed;
}

  Object.assign(ctx, {
    requestContext,
    logger,
    parseEnvNumber,
    RAW_LOG_LEVEL
  });
};
