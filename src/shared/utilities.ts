import type { Mongoose } from "mongoose";
import type {
  ConcurrentRunResult,
  DealInfo,
  LoggerFunction,
  MaybePromise,
  RuntimeEnv
} from "../types";
import { errorMessage } from "./errors";

interface ConcurrentRunOptions<T> {
  shouldAbort?: (() => boolean) | null;
  errorLogger?: ((item: T, err: unknown) => void) | null;
}

interface MongoRetryOptions {
  retries?: number;
  label?: string;
}

interface UtilitiesContext {
  mongoose: Mongoose;
  logger: LoggerFunction;
  env: RuntimeEnv;
  runConcurrent?: typeof runConcurrent;
  waitForMongoReady?: typeof waitForMongoReady;
  validatePendingDiscountSnapshot?: typeof validatePendingDiscountSnapshot;
  isTransientMongoError?: typeof isTransientMongoError;
  withMongoRetry?: typeof withMongoRetry;
}

interface MongoErrorLike {
  name?: string;
  code?: unknown;
  errorLabels?: unknown;
  message?: unknown;
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => MaybePromise<void>,
  { shouldAbort = null, errorLogger = null }: ConcurrentRunOptions<T> = {}
): Promise<ConcurrentRunResult<T>> {
  if (!Array.isArray(items) || items.length === 0) return { processed: 0, errors: [] };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;
  let processed = 0;
  const errors: ConcurrentRunResult<T>["errors"] = [];

  async function worker(): Promise<void> {
    while (true) {
      if (shouldAbort && shouldAbort()) return;
      const myIndex = nextIndex++;
      if (myIndex >= items.length) return;
      try {
        await fn(items[myIndex], myIndex);
        processed++;
      } catch (err) {
        errors.push({ index: myIndex, item: items[myIndex], error: err });
        if (errorLogger) {
          try { errorLogger(items[myIndex], err); } catch { /* ignore */ }
        }
      }
    }
  }

  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return { processed, errors };
}

async function waitForMongoReady(timeoutMs = 10000): Promise<boolean> {
  const { mongoose } = runtimeContext;
  if (mongoose.connection.readyState === 1) return true;
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      mongoose.connection.off("connected", onConnected);
      mongoose.connection.off("error", onError);
      if (timeoutId) clearTimeout(timeoutId);
    };
    const onConnected = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(true);
    };
    const onError = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(false);
    };
    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(mongoose.connection.readyState === 1);
    }, timeoutMs);
    mongoose.connection.once("connected", onConnected);
    mongoose.connection.once("error", onError);
    if (mongoose.connection.readyState === 1 && !resolved) {
      resolved = true; cleanup(); resolve(true);
    }
  });
}

function validatePendingDiscountSnapshot(snapshot: unknown): snapshot is DealInfo {
  if (!snapshot || typeof snapshot !== "object") return false;
  const deal = snapshot as DealInfo;
  if (typeof deal.title !== "string" || !deal.title) return false;
  if (typeof deal.store !== "string" || !deal.store) return false;
  if (typeof deal.link !== "string") return false;
  const sp = deal.salePrice;
  const np = deal.normalPrice;
  if (typeof sp !== "string" && typeof sp !== "number") return false;
  if (typeof np !== "string" && typeof np !== "number") return false;
  // V12: `savings` poate fi numar (pipeline curent) sau sir numeric-coercible
  // (Mongo doc-uri vechi sau cast accidental). Inainte conditia era strict
  // `typeof === "number"` si snapshot-urile cu `savings: "33"` erau silent
  // dropate din pendingDiscounts in grace window — guild-urile lung-traite
  // pierdeau notificarile pe deal-uri care reapareau dupa o pauza scurta in
  // feed. Acum acceptam si string numeric, dar respingem explicit null /
  // undefined / "" / object / array (Number(null)===0 ar fi trecut altfel ca
  // valoare valida, ceea ce nu vrem).
  // Tipul declarat in DealInfo este `number | undefined`, dar Mongo poate
  // intoarce string-uri pentru doc-uri vechi — il tratam ca `unknown` aici.
  const sav: unknown = deal.savings;
  if (typeof sav === "number") {
    if (!Number.isFinite(sav)) return false;
  } else if (typeof sav === "string") {
    if (!sav.trim()) return false;
    const num = Number(sav);
    if (!Number.isFinite(num)) return false;
  } else {
    return false;
  }
  return true;
}

const TRANSIENT_MONGO_CODES = new Set([
  112,
  189,
  11600,
  11602,
  10107,
  13435,
  13436
]);

function isTransientMongoError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const mongoErr = err as MongoErrorLike;
  if (mongoErr.name === "MongoNetworkError") return true;
  if (mongoErr.name === "MongoNetworkTimeoutError") return true;
  if (typeof mongoErr.code === "number" && TRANSIENT_MONGO_CODES.has(mongoErr.code)) return true;
  if (Array.isArray(mongoErr.errorLabels) && mongoErr.errorLabels.includes("TransientTransactionError")) return true;
  return false;
}

async function withMongoRetry<T>(
  fn: () => Promise<T>,
  { retries = runtimeContext.env.MONGO_RETRY_ATTEMPTS, label = "mongo-op" }: MongoRetryOptions = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientMongoError(err) || i === retries) throw err;
      const waitMs = Math.round(100 * (2 ** i) * (0.5 + Math.random()));
      runtimeContext.logger(
        "WARN",
        "MONGO_RETRY",
        `Retry ${label} (attempt ${i + 1}/${retries + 1}) dupa ${waitMs}ms`,
        errorMessage(err)
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

let runtimeContext: Pick<UtilitiesContext, "mongoose" | "logger" | "env">;

function attachUtilities(ctx: UtilitiesContext): void {
  runtimeContext = {
    mongoose: ctx.mongoose,
    logger: ctx.logger,
    env: ctx.env
  };

  Object.assign(ctx, {
    runConcurrent,
    waitForMongoReady,
    validatePendingDiscountSnapshot,
    isTransientMongoError,
    withMongoRetry
  });
}

// V12: expose pure helpers as static attachments on the function itself so
// tests can import them without spinning up the full ctx wiring.
Object.assign(attachUtilities, {
  validatePendingDiscountSnapshot,
  isTransientMongoError
});

export = attachUtilities;
