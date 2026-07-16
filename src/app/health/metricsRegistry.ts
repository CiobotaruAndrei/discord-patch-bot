import type { BotMetrics, CommandCacheSizes } from "../../types.js";
import { getNativeFallbackTotals, NATIVE_FALLBACK_FUNCTIONS } from "../../native/fuzzy.js";

type PrometheusMetricType = "counter" | "gauge";

interface MetricsSnapshotInput {
  metrics: BotMetrics;
  cacheSizes: CommandCacheSizes;
  guildCacheSize: number;
  enrichedDealsCacheSize: number;
  rateLimitMapSize: number;
  activeLocksSize: number;
}

function formatLabels(labels?: Record<string, string>): string {
  if (!labels) return "";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const inner = entries
    .map(([key, value]) => `${key}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n")}"`)
    .join(",");
  return `{${inner}}`;
}

function pushMetric(
  lines: string[],
  seenNames: Set<string>,
  name: string,
  type: PrometheusMetricType,
  help: string,
  value: string | number,
  labels?: Record<string, string>
): void {
  const labeled = Boolean(labels && Object.keys(labels).length > 0);
  if (seenNames.has(name) && !labeled) return;
  if (!seenNames.has(name)) {
    seenNames.add(name);
    lines.push(
      `# HELP ${name} ${help}`,
      `# TYPE ${name} ${type}`
    );
  }
  lines.push(`${name}${formatLabels(labels)} ${value}`);
}

function renderPrometheusMetrics(input: MetricsSnapshotInput): string {
  const { metrics, cacheSizes, guildCacheSize, enrichedDealsCacheSize, rateLimitMapSize, activeLocksSize } = input;
  const lines: string[] = [];
  const seenMetricNames = new Set<string>();
  pushMetric(lines, seenMetricNames, "bot_uptime_seconds", "gauge", "Bot uptime", Math.floor((Date.now() - metrics.startedAt) / 1000));
  pushMetric(lines, seenMetricNames, "bot_fetch_success", "counter", "Fetch reusite", metrics.fetchSuccess);
  pushMetric(lines, seenMetricNames, "bot_fetch_fail", "counter", "Fetch esuate", metrics.fetchFail);
  pushMetric(lines, seenMetricNames, "bot_http_retries", "counter", "HTTP retries", metrics.httpRetries);
  pushMetric(lines, seenMetricNames, "bot_rate_limit_hits", "counter", "Rate limit hits (upstream)", metrics.rateLimitHits);
  pushMetric(lines, seenMetricNames, "bot_cron_runs", "counter", "Cron runs", metrics.cronRuns);
  pushMetric(lines, seenMetricNames, "bot_cron_errors", "counter", "Cron errors", metrics.cronErrors);
  pushMetric(lines, seenMetricNames, "bot_cron_skipped_due_to_lock", "counter", "Cron skipped", metrics.cronSkippedDueToLock);
  pushMetric(lines, seenMetricNames, "bot_cron_aborted", "counter", "Cron aborted", metrics.cronAborted);
  pushMetric(lines, seenMetricNames, "bot_cron_skipped_due_to_health", "counter", "Cron skipped by global health backoff", metrics.cronSkippedDueToHealth || 0);
  pushMetric(lines, seenMetricNames, "bot_http_rate_limit_drops", "counter", "HTTP requests blocked by local rate limiter", metrics.httpRateLimitDrops);
  pushMetric(lines, seenMetricNames, "bot_http_handler_errors", "counter", "HTTP handler exceptions caught by the top-level try/catch (returned 500; >0 means /health or /metrics rendering threw)", metrics.httpHandlerErrors);
  pushMetric(lines, seenMetricNames, "bot_cache_single", "gauge", "Cache single size", cacheSizes.single);
  pushMetric(lines, seenMetricNames, "bot_cache_dlc", "gauge", "Cache DLC size", cacheSizes.dlc);
  pushMetric(lines, seenMetricNames, "bot_cache_updates_valid", "gauge", "Updates cache valid", cacheSizes.updatesValid ? 1 : 0);
  pushMetric(lines, seenMetricNames, "bot_cache_deals_currencies_valid", "gauge", "Deals cache currencies count", cacheSizes.dealsCurrenciesValid);
  pushMetric(lines, seenMetricNames, "bot_cache_user_cooldowns", "gauge", "User cooldowns size", cacheSizes.userCooldowns);
  pushMetric(lines, seenMetricNames, "bot_cache_guild_settings", "gauge", "Guild settings cache size", guildCacheSize);
  pushMetric(lines, seenMetricNames, "bot_cache_enriched_deals_size", "gauge", "Enriched deals cache size", enrichedDealsCacheSize);
  pushMetric(lines, seenMetricNames, "bot_http_rate_limit_map_size", "gauge", "Local HTTP rate limit map size", rateLimitMapSize);
  pushMetric(lines, seenMetricNames, "bot_active_locks", "gauge", "Active distributed locks", activeLocksSize);
  pushMetric(lines, seenMetricNames, "bot_outbox_sent", "counter", "Notification outbox jobs delivered", metrics.outboxSent);
  pushMetric(lines, seenMetricNames, "bot_outbox_retried", "counter", "Notification outbox jobs retried", metrics.outboxRetried);
  pushMetric(lines, seenMetricNames, "bot_outbox_dead_lettered", "counter", "Notification outbox jobs dead-lettered", metrics.outboxDeadLettered);
  pushMetric(lines, seenMetricNames, "bot_outbox_expired", "counter", "Notification outbox jobs dead-lettered due to age before TTL expiry", metrics.outboxExpired);
  pushMetric(lines, seenMetricNames, "bot_outbox_drains", "counter", "Notification outbox drain cycles", metrics.outboxDrains);
  pushMetric(lines, seenMetricNames, "bot_outbox_queue_depth", "gauge", "Notification outbox jobs currently queued", metrics.outboxQueueDepth);
  pushMetric(lines, seenMetricNames, "bot_outbox_delivery_ms_total", "counter", "Total ms spent delivering outbox jobs (with bot_outbox_sent gives avg latency)", metrics.outboxDeliveryMsTotal);
  pushMetric(lines, seenMetricNames, "bot_outbox_oldest_job_age_seconds", "gauge", "Age of the oldest DUE outbox job (availableAt <= now); jobs scheduled for the future are excluded", metrics.outboxOldestJobAgeSeconds);
  pushMetric(lines, seenMetricNames, "bot_outbox_future_scheduled_jobs", "gauge", "Outbox jobs scheduled for future delivery (availableAt > now, e.g. staggered manual batches or backoff retries)", metrics.outboxFutureScheduledJobs);
  pushMetric(lines, seenMetricNames, "bot_outbox_lock_acquire_failures", "counter", "Outbox drain lock acquisition skipped (held by another instance)", metrics.outboxLockAcquireFailures);
  pushMetric(lines, seenMetricNames, "bot_outbox_pause_check_failures", "counter", "Outbox pause-flag reads that failed (worker skips the cycle fail-closed)", metrics.outboxPauseCheckFailures);
  pushMetric(lines, seenMetricNames, "bot_outbox_recovery_duplicates_prevented", "counter", "Outbox recovery-verify duplicate sends prevented", metrics.outboxRecoveryDuplicates);
  pushMetric(lines, seenMetricNames, "bot_outbox_recovery_history_fetches", "counter", "Outbox recovery-verify channel history fetches", metrics.outboxRecoveryFetches);
  pushMetric(lines, seenMetricNames, "bot_outbox_recovery_verify_failures", "counter", "Outbox recovery-verify channel history fetch failures", metrics.outboxRecoveryFailures);
  pushMetric(lines, seenMetricNames, "bot_outbox_recovery_marker_missing", "counter", "Outbox recovery-verify fetched history but marker not found (re-sent)", metrics.outboxRecoveryMarkerMissing);
  pushMetric(lines, seenMetricNames, "bot_outbox_mark_sent_failures", "counter", "Outbox deliveries that could not be recorded in the sent-dedupe history", metrics.outboxMarkSentFailures);
  pushMetric(lines, seenMetricNames, "bot_outbox_delete_failures", "counter", "Outbox jobs that could not be deleted after processing (remain queued, deduped/retried)", metrics.outboxDeleteFailures);
  pushMetric(lines, seenMetricNames, "bot_outbox_deadletter_write_failures", "counter", "Outbox dead-letter audit writes that failed (terminal jobs kept for replay; an already-delivered job is deleted without audit)", metrics.outboxDeadLetterWriteFailures);
  pushMetric(lines, seenMetricNames, "bot_history_write_failures", "counter", "Delivered notifications whose notificationHistory write failed (delivery still succeeded)", metrics.outboxHistoryWriteFailures);
  pushMetric(lines, seenMetricNames, "bot_outbox_recovery_verify_enabled_guilds", "gauge", "Guilds with per-guild outbox recovery-verify enabled", metrics.outboxRecoveryVerifyEnabledGuilds);
  pushMetric(lines, seenMetricNames, "bot_outbox_last_drain_age_seconds", "gauge", "Seconds since the last completed outbox drain (0 = never; grows when the worker is paused/not draining)", metrics.outboxLastDrainAt > 0 ? Math.max(0, Math.round((Date.now() - metrics.outboxLastDrainAt) / 1000)) : 0);
  pushMetric(lines, seenMetricNames, "bot_redis_connect_success", "counter", "Redis connection successes at boot (0 when REDIS_URL is unset)", metrics.redisConnectSuccess);
  pushMetric(lines, seenMetricNames, "bot_redis_connect_failure", "counter", "Redis connection failures at boot", metrics.redisConnectFailure);
  pushMetric(lines, seenMetricNames, "bot_redis_cache_hit", "counter", "Redis cache reads that returned a value (JSON cache)", metrics.redisCacheHit);
  pushMetric(lines, seenMetricNames, "bot_redis_cache_miss", "counter", "Redis cache reads that missed (key absent)", metrics.redisCacheMiss);
  pushMetric(lines, seenMetricNames, "bot_redis_errors", "counter", "Redis client/cache errors (client error events + cache operation failures)", metrics.redisErrors);
  pushMetric(lines, seenMetricNames, "bot_guild_settings_listener_failures", "counter", "GuildSettingsChanged listener/publisher failures (counted even when the error reporter itself throws)", metrics.guildSettingsListenerFailures);
  pushMetric(lines, seenMetricNames, "bot_security_runtime_errors", "counter", "Security runtime event failures", metrics.securityRuntimeErrors ?? 0);
  pushMetric(lines, seenMetricNames, "bot_security_threats_deleted", "counter", "Confirmed dangerous messages deleted", metrics.securityThreatsDeleted ?? 0);
  pushMetric(lines, seenMetricNames, "bot_security_bot_adds_blocked", "counter", "Unauthorized bot additions blocked", metrics.securityBotAddsBlocked ?? 0);
  pushMetric(lines, seenMetricNames, "bot_permission_delegations_reverted", "counter", "Unauthorized protected permission grants reverted", metrics.permissionDelegationsReverted ?? 0);
  const commandNames = Array.from(new Set([...Object.keys(metrics.commandRuns), ...Object.keys(metrics.commandErrors)])).sort();
  for (const commandName of commandNames) {
    pushMetric(lines, seenMetricNames, "bot_commands_total", "counter", "Slash command interactions handled, per top-level command", metrics.commandRuns[commandName] || 0, { command: commandName });
  }
  for (const commandName of commandNames) {
    pushMetric(lines, seenMetricNames, "bot_command_errors_total", "counter", "Slash command interactions that escaped to the top-level interaction handler, per command", metrics.commandErrors[commandName] || 0, { command: commandName });
  }
  for (const commandName of commandNames) {
    pushMetric(lines, seenMetricNames, "bot_command_duration_ms_total", "counter", "Total handling time in ms per top-level command (avg = duration_ms_total / commands_total)", metrics.commandDurationMsTotal[commandName] || 0, { command: commandName });
  }
  const nativeFallbackTotals = getNativeFallbackTotals();
  const nativeFallbackFns = Array.from(new Set([...NATIVE_FALLBACK_FUNCTIONS, ...Object.keys(nativeFallbackTotals)]));
  for (const fnName of nativeFallbackFns) {
    pushMetric(lines, seenMetricNames, "bot_native_fallback_total", "counter", "Native (Rust) calls that threw and fell back to the TypeScript implementation, per function (>0 means that native function is partially failing)", nativeFallbackTotals[fnName] || 0, { fn: fnName });
  }
  return lines.join("\n") + "\n";
}

export { renderPrometheusMetrics };
export type { MetricsSnapshotInput };
