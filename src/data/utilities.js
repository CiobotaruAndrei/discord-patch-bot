"use strict";

module.exports = (ctx) => {
  const { mongoose } = ctx;

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

  Object.assign(ctx, {
    runConcurrent,
    waitForMongoReady,
    validatePendingDiscountSnapshot
  });
};
