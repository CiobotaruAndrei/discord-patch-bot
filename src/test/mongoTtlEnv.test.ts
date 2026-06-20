import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeEnv, ParseEnvNumberLimits } from "../types";

const { z } = require("zod") as typeof import("zod");
const attachEnv = require("../shared/env") as (target: Record<string, unknown>) => void;

function clampingParseEnvNumber(name: string, defaultValue: number, limits: ParseEnvNumberLimits = {}): number {
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
    const target: Record<string, unknown> = { z, logger: () => undefined, parseEnvNumber: clampingParseEnvNumber, RAW_LOG_LEVEL: "INFO" };
    attachEnv(target);
    return target.env as RuntimeEnv;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("env builder expune TTL-urile Mongo in RuntimeEnv cu default-urile asteptate (parsate o singura data, injectabile in models)", () => {
  const env = buildEnv({
    GUILD_SEEN_DISCOUNT_TTL_DAYS: undefined,
    NOTIFICATION_OUTBOX_SENT_TTL_HOURS: undefined,
    NOTIFICATION_HISTORY_TTL_DAYS: undefined,
    FEEDBACK_REPORT_TTL_DAYS: undefined,
    NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: undefined
  });
  assert.equal(env.GUILD_SEEN_DISCOUNT_TTL_DAYS, 60);
  assert.equal(env.NOTIFICATION_OUTBOX_SENT_TTL_HOURS, 24);
  assert.equal(env.NOTIFICATION_HISTORY_TTL_DAYS, 30);
  assert.equal(env.FEEDBACK_REPORT_TTL_DAYS, 90);
  assert.equal(env.NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS, 7);
});

test("env builder clampeaza TTL-urile Mongo in intervalul [min, max] (acelasi comportament defensiv ca inainte)", () => {
  const low = buildEnv({ GUILD_SEEN_DISCOUNT_TTL_DAYS: "10", NOTIFICATION_OUTBOX_SENT_TTL_HOURS: "0" });
  assert.equal(low.GUILD_SEEN_DISCOUNT_TTL_DAYS, 30, "GUILD_SEEN_DISCOUNT_TTL_DAYS sub minim -> 30");
  assert.equal(low.NOTIFICATION_OUTBOX_SENT_TTL_HOURS, 1, "NOTIFICATION_OUTBOX_SENT_TTL_HOURS sub minim -> 1");

  const high = buildEnv({ NOTIFICATION_HISTORY_TTL_DAYS: "9999", NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: "9999" });
  assert.equal(high.NOTIFICATION_HISTORY_TTL_DAYS, 180, "NOTIFICATION_HISTORY_TTL_DAYS peste maxim -> 180");
  assert.equal(high.NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS, 30, "NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS peste maxim -> 30");
});

test("env builder pastreaza valorile TTL valide din interval", () => {
  const env = buildEnv({ FEEDBACK_REPORT_TTL_DAYS: "120", GUILD_SEEN_DISCOUNT_TTL_DAYS: "200" });
  assert.equal(env.FEEDBACK_REPORT_TTL_DAYS, 120);
  assert.equal(env.GUILD_SEEN_DISCOUNT_TTL_DAYS, 200);
});
