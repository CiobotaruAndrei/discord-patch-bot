import test from "node:test";
import assert from "node:assert/strict";
import { renderPrometheusMetrics } from "../../app/health/metricsRegistry.js";
import type { BotMetrics } from "../../app/health/metricsTypes.js";

function makeMetrics(overrides: Partial<BotMetrics> = {}): BotMetrics {
  return {
    startedAt: Date.now() - 5_000, fetchSuccess: 7, fetchFail: 2, httpRetries: 0,
    rateLimitHits: 0, cronRuns: 0, cronErrors: 0, cronSkippedDueToLock: 0,
    cronAborted: 0, cronSkippedDueToHealth: 0, httpRateLimitDrops: 0, httpHandlerErrors: 0,
    outboxSent: 0, outboxRetried: 0, outboxDeadLettered: 0, outboxExpired: 0, outboxDrains: 0, outboxQueueDepth: 0,
    outboxDeliveryMsTotal: 0, outboxOldestJobAgeSeconds: 0, outboxFutureScheduledJobs: 0, outboxLockAcquireFailures: 0, outboxPauseCheckFailures: 0,
    outboxRecoveryDuplicates: 0, outboxRecoveryFetches: 0, outboxRecoveryFailures: 0, outboxRecoveryMarkerMissing: 0, outboxMarkSentFailures: 0, outboxDeleteFailures: 0, outboxDeadLetterWriteFailures: 0, outboxHistoryWriteFailures: 0, outboxRecoveryVerifyEnabledGuilds: 0, outboxLastDrainAt: 0,
    redisConnectSuccess: 0, redisConnectFailure: 0, redisCacheHit: 0, redisCacheMiss: 0, redisErrors: 0, guildSettingsListenerFailures: 0,
    commandRuns: {}, commandErrors: {}, commandDurationMsTotal: {},
    ...overrides
  };
}

const baseInput = {
  cacheSizes: { single: 3, dlc: 1, updatesValid: true, dealsCurrenciesValid: 2, userCooldowns: 4 },
  guildCacheSize: 5,
  enrichedDealsCacheSize: 6,
  rateLimitMapSize: 7,
  activeLocksSize: 8
};

test("renderPrometheusMetrics: emite HELP/TYPE o singura data per metrica si valorile scalare corecte", () => {
  const body = renderPrometheusMetrics({ metrics: makeMetrics(), ...baseInput });
  assert.match(body, /# HELP bot_fetch_success Fetch reusite\n# TYPE bot_fetch_success counter\nbot_fetch_success 7/);
  assert.match(body, /bot_fetch_fail 2/);
  assert.match(body, /bot_cache_guild_settings 5/);
  assert.match(body, /bot_cache_enriched_deals_size 6/);
  assert.match(body, /bot_http_rate_limit_map_size 7/);
  assert.match(body, /bot_active_locks 8/);
  assert.equal(body.match(/# TYPE bot_fetch_success /g)?.length, 1, "HELP/TYPE nu se dubleaza");
  assert.ok(body.endsWith("\n"), "corpul se termina cu newline");
});

test("renderPrometheusMetrics: expune bot_guild_settings_listener_failures (esecuri de listeneri GuildSettingsChanged, review nou #17)", () => {
  const body = renderPrometheusMetrics({ metrics: makeMetrics({ guildSettingsListenerFailures: 3 }), ...baseInput });
  assert.match(body, /# TYPE bot_guild_settings_listener_failures counter/);
  assert.match(body, /bot_guild_settings_listener_failures 3/);
});

test("renderPrometheusMetrics: seriile per comanda apar cu label, sortate, chiar si comenzi cu 0 runs dar erori", () => {
  const metrics = makeMetrics({
    commandRuns: { ping: 3, alpha: 1 },
    commandErrors: { backup: 2, ping: 0 },
    commandDurationMsTotal: { ping: 900 }
  });
  const body = renderPrometheusMetrics({ metrics, ...baseInput });
  assert.match(body, /bot_commands_total\{command="ping"\} 3/);
  assert.match(body, /bot_commands_total\{command="alpha"\} 1/);
  assert.match(body, /bot_commands_total\{command="backup"\} 0/, "comanda cu erori dar fara runs apare cu 0");
  assert.match(body, /bot_command_errors_total\{command="backup"\} 2/);
  assert.match(body, /bot_command_duration_ms_total\{command="ping"\} 900/);
  const alphaIdx = body.indexOf('bot_commands_total{command="alpha"}');
  const pingIdx = body.indexOf('bot_commands_total{command="ping"}');
  assert.ok(alphaIdx < pingIdx, "numele de comenzi sunt sortate alfabetic (alpha inainte de ping)");
  assert.equal(body.match(/# TYPE bot_commands_total /g)?.length, 1, "familia labeled emite HELP/TYPE o singura data");
});

test("renderPrometheusMetrics: uptime deriva din startedAt (secunde intregi >= 0)", () => {
  const body = renderPrometheusMetrics({ metrics: makeMetrics({ startedAt: Date.now() - 12_000 }), ...baseInput });
  const match = body.match(/\nbot_uptime_seconds (\d+)/);
  assert.ok(match, "bot_uptime_seconds prezent");
  assert.ok(Number(match![1]) >= 12, "uptime reflecta startedAt");
});
