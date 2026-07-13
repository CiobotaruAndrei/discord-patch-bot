interface RedisMetricsCounters {
  redisConnectSuccess: number;
  redisConnectFailure: number;
  redisCacheHit: number;
  redisCacheMiss: number;
  redisErrors: number;
}

let ref: RedisMetricsCounters | null = null;

function attachRedisMetrics(target: RedisMetricsCounters | null): void {
  ref = target;
}

function recordRedisConnectSuccess(): void {
  if (ref) ref.redisConnectSuccess += 1;
}

function recordRedisConnectFailure(): void {
  if (ref) ref.redisConnectFailure += 1;
}

function recordRedisCacheHit(): void {
  if (ref) ref.redisCacheHit += 1;
}

function recordRedisCacheMiss(): void {
  if (ref) ref.redisCacheMiss += 1;
}

function recordRedisError(): void {
  if (ref) ref.redisErrors += 1;
}

export default {
  attachRedisMetrics,
  recordRedisConnectSuccess,
  recordRedisConnectFailure,
  recordRedisCacheHit,
  recordRedisCacheMiss,
  recordRedisError
};
