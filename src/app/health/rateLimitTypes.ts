import type { IncomingMessage } from "http";

export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitRequest {
  headers: IncomingMessage["headers"];
  socket?: { remoteAddress?: string };
}

export interface RateLimiter {
  check(req: RateLimitRequest): boolean;
  prune(): void;
  readonly size: number;
  readonly retryAfterSeconds: number;
}
