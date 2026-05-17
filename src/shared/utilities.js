"use strict";

module.exports = (ctx) => {
  const { mongoose, logger, env } = ctx;

async function runConcurrent(items, concurrency, fn, { shouldAbort = null, errorLogger = null } = {}) {
  if (!Array.isArray(items) || items.length === 0) return { processed: 0, errors: [] };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  let nextIndex = 0;
  let processed = 0;
  const errors = [];

  async function worker() {
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

// -------------------------------------------------------------
// waitForMongoReady
// -------------------------------------------------------------
async function waitForMongoReady(timeoutMs = 10000) {
  if (mongoose.connection.readyState === 1) return true;
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      mongoose.connection.off("connected", onConnected);
      mongoose.connection.off("error", onError);
      clearTimeout(t);
    };
    const onConnected = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(true);
    };
    const onError = () => {
      if (resolved) return;
      resolved = true; cleanup(); resolve(false);
    };
    const t = setTimeout(() => {
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

// -------------------------------------------------------------
// validatePendingDiscountSnapshot
// -------------------------------------------------------------
function validatePendingDiscountSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  if (typeof snapshot.title !== "string" || !snapshot.title) return false;
  if (typeof snapshot.store !== "string" || !snapshot.store) return false;
  if (typeof snapshot.link !== "string") return false;
  const sp = snapshot.salePrice;
  const np = snapshot.normalPrice;
  if (typeof sp !== "string" && typeof sp !== "number") return false;
  if (typeof np !== "string" && typeof np !== "number") return false;
  if (typeof snapshot.savings !== "number" || !Number.isFinite(snapshot.savings)) return false;
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

function isTransientMongoError(err) {
  if (!err) return false;
  if (err.name === "MongoNetworkError") return true;
  if (err.name === "MongoNetworkTimeoutError") return true;
  if (TRANSIENT_MONGO_CODES.has(err.code)) return true;
  if (Array.isArray(err.errorLabels) && err.errorLabels.includes("TransientTransactionError")) return true;
  return false;
}

async function withMongoRetry(fn, { retries = env.MONGO_RETRY_ATTEMPTS, label = "mongo-op" } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientMongoError(err) || i === retries) throw err;
      const waitMs = Math.round(100 * (2 ** i) * (0.5 + Math.random()));
      logger("WARN", "MONGO_RETRY", `Retry ${label} (attempt ${i + 1}/${retries + 1}) dupa ${waitMs}ms`, err.message);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw lastErr;
}

  Object.assign(ctx, {
    runConcurrent,
    waitForMongoReady,
    validatePendingDiscountSnapshot,
    isTransientMongoError,
    withMongoRetry
  });
};
