import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEnv, ParseEnvNumberLimits } from "../types";

import { z } from "zod";
import attachEnv from "../shared/env";

function parseEnvNumber(name: string, defaultValue: number, limits: ParseEnvNumberLimits = {}): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return defaultValue;
  const min = limits.min ?? -Infinity;
  const max = limits.max ?? Infinity;
  return Math.min(Math.max(raw, min), max);
}

function buildEnv(overrides: Record<string, string | undefined>): RuntimeEnv {
  const saved: Record<string, string | undefined> = {};
  const keys = ["MONGO_URI", "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "NODE_ENV", ...Object.keys(overrides)];
  for (const key of keys) saved[key] = process.env[key];
  process.env.MONGO_URI = "mongodb://localhost/test";
  process.env.DISCORD_TOKEN = "test-token";
  process.env.DISCORD_CLIENT_ID = "test-client";
  delete process.env.NODE_ENV;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    const target: Record<string, unknown> = { z, logger: () => undefined, parseEnvNumber, RAW_LOG_LEVEL: "INFO" };
    attachEnv(target as object as Parameters<typeof attachEnv>[0]);
    return target.env as RuntimeEnv;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("env builder expune configuratia outbox in RuntimeEnv din variabilele de mediu (injectabila, parsata o singura data)", () => {
  const env = buildEnv({
    NOTIFICATION_OUTBOX_ENABLED: "true",
    NOTIFICATION_OUTBOX_DRAIN_LIMIT: "77",
    NOTIFICATION_OUTBOX_MAX_AGE_MS: "7200000",
    NOTIFICATION_OUTBOX_RECOVERY_VERIFY: "1",
    NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: "40"
  });
  assert.equal(env.NOTIFICATION_OUTBOX_ENABLED, true);
  assert.equal(env.NOTIFICATION_OUTBOX_DRAIN_LIMIT, 77);
  assert.equal(env.NOTIFICATION_OUTBOX_MAX_AGE_MS, 7200000);
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY, true, "parseBooleanEnv accepta si '1', nu doar 'true'");
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_STRICT, false, "neset -> false");
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT, 40);
});

test("env builder aplica default-urile outbox cand variabilele lipsesc", () => {
  const env = buildEnv({
    NOTIFICATION_OUTBOX_ENABLED: undefined,
    NOTIFICATION_OUTBOX_DRAIN_LIMIT: undefined,
    NOTIFICATION_OUTBOX_MAX_AGE_MS: undefined,
    NOTIFICATION_OUTBOX_RECOVERY_VERIFY: undefined,
    NOTIFICATION_OUTBOX_RECOVERY_STRICT: undefined,
    NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: undefined
  });
  assert.equal(env.NOTIFICATION_OUTBOX_ENABLED, false);
  assert.equal(env.NOTIFICATION_OUTBOX_DRAIN_LIMIT, 50);
  assert.equal(env.NOTIFICATION_OUTBOX_MAX_AGE_MS, 6 * 24 * 3600_000);
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY, false);
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_STRICT, false);
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT, 25);
});

test("env builder clampeaza valorile outbox in afara limitelor", () => {
  const env = buildEnv({
    NOTIFICATION_OUTBOX_DRAIN_LIMIT: "999999",
    NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT: "1"
  });
  assert.equal(env.NOTIFICATION_OUTBOX_DRAIN_LIMIT, 1000, "drain limit clampat la max 1000");
  assert.equal(env.NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT, 5, "history limit clampat la min 5");
});
