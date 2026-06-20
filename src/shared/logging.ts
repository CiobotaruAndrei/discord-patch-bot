import type { AsyncLocalStorage } from "async_hooks";
import type { LogLevel, LoggerFunction, ParseEnvNumber, ParseEnvNumberLimits, RequestContextStore } from "../types";

type AsyncLocalStorageCtor = new <T>() => AsyncLocalStorage<T>;

interface LoggingContext {
  AsyncLocalStorage: AsyncLocalStorageCtor;
  requestContext?: AsyncLocalStorage<RequestContextStore>;
  logger?: LoggerFunction;
  parseEnvNumber?: ParseEnvNumber;
  RAW_LOG_LEVEL?: string;
  LOG_SAMPLE_RATE?: number;
  getAbortSignal?: () => AbortSignal | null;
}

interface LogEntry {
  ts: string;
  level: string;
  context: string;
  message: string;
  requestId?: string;
  meta?: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

type EnvNumberResolution =
  | { kind: "ok"; value: number }
  | { kind: "default"; value: number }
  | { kind: "clamped"; value: number; message: string }
  | { kind: "invalid"; value: number; message: string };

function envRangeHint(min: number, max: number): string {
  if (min === 0 && max === Infinity) return "";
  return ` (interval permis ${min}..${max === Infinity ? "infinit" : max})`;
}

function classifyEnvNumber(name: string, raw: string | undefined, defaultValue: number, { min = 0, max = Infinity }: ParseEnvNumberLimits = {}): EnvNumberResolution {
  if (raw === undefined || raw === "") return { kind: "default", value: defaultValue };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { kind: "invalid", value: defaultValue, message: `${name}="${raw}" nu este un numar valid${envRangeHint(min, max)}` };
  }
  if (parsed < min) return { kind: "clamped", value: min, message: `${name}=${parsed} sub minimul ${min}, folosesc minimul` };
  if (parsed > max) return { kind: "clamped", value: max, message: `${name}=${parsed} peste maximul ${max}, folosesc maximul` };
  return { kind: "ok", value: parsed };
}

function attachLogging(target: LoggingContext): void {
  const { AsyncLocalStorage } = target;

  const requestContext = new AsyncLocalStorage<RequestContextStore>();

  const RAW_LOG_LEVEL = (process.env.LOG_LEVEL || "INFO").toUpperCase();
  const ACTIVE_LOG_LEVEL = LOG_LEVELS[RAW_LOG_LEVEL as LogLevel] ?? LOG_LEVELS.INFO;
  const LOG_SAMPLE_RATE = (() => {
    const raw = process.env.LOG_SAMPLE_RATE;
    if (raw === undefined || raw === "") return 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.floor(parsed);
  })();
  let sampleCounter = 0;

  const LOG_FORMAT = (process.env.LOG_FORMAT || "").toLowerCase();
  const USE_JSON_LOGS = LOG_FORMAT === "json"
    || (LOG_FORMAT !== "text" && !process.stdout.isTTY);

  function logger(level: LogLevel | string, context: string, message: string, meta: unknown = ""): void {
    const lvlKey = String(level || "INFO").toUpperCase();
    const lvl = LOG_LEVELS[lvlKey as LogLevel] ?? LOG_LEVELS.INFO;
    if (lvl < ACTIVE_LOG_LEVEL) return;

    if (LOG_SAMPLE_RATE > 1 && lvl < LOG_LEVELS.WARN) {
      sampleCounter = (sampleCounter + 1) % LOG_SAMPLE_RATE;
      if (sampleCounter !== 0) return;
    }

    const ts = new Date().toISOString();
    const currentContext = requestContext.getStore();
    const reqId = currentContext?.requestId;

    if (USE_JSON_LOGS) {
      const entry: LogEntry = { ts, level: lvlKey, context, message };
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
      let line: string;
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

  function parseEnvNumber(name: string, defaultValue: number, limits: ParseEnvNumberLimits = {}): number {
    const resolution = classifyEnvNumber(name, process.env[name], defaultValue, limits);
    if (resolution.kind === "invalid") {
      logger("ERROR", "ENV", `Pornire blocata: ${resolution.message}. Corecteaza variabila in mediu (vezi src/.env.example) si reporneste.`);
      process.exit(1);
    }
    if (resolution.kind === "clamped") logger("WARN", "ENV", resolution.message);
    return resolution.value;
  }

  function getAbortSignal(): AbortSignal | null {
    return requestContext.getStore()?.abortSignal || null;
  }

  Object.assign(target, {
    requestContext,
    logger,
    parseEnvNumber,
    RAW_LOG_LEVEL,
    LOG_SAMPLE_RATE,
    getAbortSignal
  });
}

attachLogging.classifyEnvNumber = classifyEnvNumber;

export = attachLogging;
