import test from "node:test";
import assert from "node:assert/strict";
import { buildSourcesTuningEnv, buildCycleTuningEnv, buildCacheTuningEnv } from "../../shared/envTuning.js";

type Limits = { min?: number; max?: number };
type Call = { name: string; def: number; limits?: Limits };

function recordingParseEnvNumber() {
  const calls: Call[] = [];
  const parse = (name: string, def: number, limits?: Limits): number => {
    calls.push({ name, def, limits });
    return def;
  };
  return { parse, calls };
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

function callFor(calls: Call[], name: string): Call {
  const found = calls.find(c => c.name === name);
  assert.ok(found, `parseEnvNumber nu a fost chemat pentru ${name}`);
  return found!;
}

test("buildSourcesTuningEnv: cheile de fetch/deal/discord-send cu default-urile si limitele lor", () => {
  const { parse, calls } = recordingParseEnvNumber();
  const slice = buildSourcesTuningEnv(parse);
  assert.deepEqual(callFor(calls, "FETCH_CONCURRENCY"), { name: "FETCH_CONCURRENCY", def: 10, limits: { min: 1, max: 50 } });
  assert.deepEqual(callFor(calls, "MAX_HTML_BYTES").limits, { min: 50_000, max: 50_000_000 });
  assert.deepEqual(callFor(calls, "DISCORD_SEND_RATE_MAX_WAIT_MS"), { name: "DISCORD_SEND_RATE_MAX_WAIT_MS", def: 5000, limits: { min: 1, max: 60000 } });
  assert.equal(slice.MAX_DEALS, 50);
  assert.ok(!("MAX_UPDATES_PER_CYCLE" in slice), "campurile de ciclu nu apartin subsistemului de surse");
});

test("buildCycleTuningEnv: foloseste duratele injectate pentru age/cooldown", () => {
  const { parse, calls } = recordingParseEnvNumber();
  const slice = buildCycleTuningEnv(parse, { ONE_HOUR_MS, ONE_DAY_MS, THIRTY_DAYS_MS });
  assert.deepEqual(callFor(calls, "PENDING_UPDATE_MAX_AGE_MS"), { name: "PENDING_UPDATE_MAX_AGE_MS", def: ONE_DAY_MS, limits: { min: 60_000, max: THIRTY_DAYS_MS } });
  assert.deepEqual(callFor(calls, "CIRCUIT_BREAKER_COOLDOWN_MS"), { name: "CIRCUIT_BREAKER_COOLDOWN_MS", def: 45 * 60 * 1000, limits: { min: 60_000, max: 12 * ONE_HOUR_MS } });
  assert.equal(callFor(calls, "CIRCUIT_BREAKER_JITTER_MS").limits?.max, 2 * ONE_HOUR_MS);
  assert.equal(slice.GLOBAL_HEALTH_MIN_RATIO, 30);
});

test("buildCacheTuningEnv: cache/mongo/http-rate-limit cu ONE_HOUR_MS injectat", () => {
  const { parse, calls } = recordingParseEnvNumber();
  const slice = buildCacheTuningEnv(parse, { ONE_HOUR_MS });
  assert.deepEqual(callFor(calls, "HTTP_RATE_LIMIT_WINDOW_MS"), { name: "HTTP_RATE_LIMIT_WINDOW_MS", def: 60_000, limits: { min: 1000, max: ONE_HOUR_MS } });
  assert.deepEqual(callFor(calls, "MONGO_MAX_POOL_SIZE"), { name: "MONGO_MAX_POOL_SIZE", def: 15, limits: { min: 1, max: 200 } });
  assert.equal(callFor(calls, "GUILD_CACHE_TTL_MS").limits?.max, ONE_HOUR_MS);
  assert.equal(slice.COMMAND_OUTPUT_MAX_CHARS, 1900);
});

test("cele trei subsisteme au chei disjuncte (nicio suprapunere la compunerea in RuntimeEnv)", () => {
  const noop = (_n: string, d: number): number => d;
  const sources = Object.keys(buildSourcesTuningEnv(noop));
  const cycle = Object.keys(buildCycleTuningEnv(noop, { ONE_HOUR_MS, ONE_DAY_MS, THIRTY_DAYS_MS }));
  const cache = Object.keys(buildCacheTuningEnv(noop, { ONE_HOUR_MS }));
  const all = [...sources, ...cycle, ...cache];
  assert.equal(new Set(all).size, all.length, "cheile de tuning trebuie sa fie disjuncte intre subsisteme");
});
