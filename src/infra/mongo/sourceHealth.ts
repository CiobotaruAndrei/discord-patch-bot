"use strict";

import type { SourceHealthDoc } from "../../sources/sourceHealth.js";

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

interface CircuitBreakerModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<unknown> };
}

type LoadSourceHealth = () => Promise<SourceHealthDoc[]>;

interface SourceHealthContext {
  CircuitBreakerModel: CircuitBreakerModelLike;
  logger: Logger;
  loadSourceHealth?: LoadSourceHealth;
}

function toSourceHealthDoc(value: unknown): SourceHealthDoc | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { _id?: unknown; fails?: unknown; cooldownUntil?: unknown; schemaDriftFails?: unknown };
  if (typeof raw._id !== "string") return null;
  return {
    key: raw._id,
    fails: typeof raw.fails === "number" ? raw.fails : 0,
    cooldownUntil: raw.cooldownUntil instanceof Date || typeof raw.cooldownUntil === "string" ? raw.cooldownUntil : null,
    schemaDriftFails: typeof raw.schemaDriftFails === "number" ? raw.schemaDriftFails : 0
  };
}

function buildSourceHealthFrom(context: SourceHealthContext) {
  const { CircuitBreakerModel, logger } = context;

  const loadSourceHealth: LoadSourceHealth = async () => {
    try {
      const raw = await CircuitBreakerModel.find({}).lean();
      return Array.isArray(raw)
        ? raw.map(toSourceHealthDoc).filter((doc): doc is SourceHealthDoc => doc !== null)
        : [];
    } catch (err) {
      logger("WARN", "SOURCE_HEALTH", "Nu am putut citi starea circuit breaker-elor de surse",
        err instanceof Error ? err.message : String(err));
      return [];
    }
  };

  return { loadSourceHealth };
}

function attachSourceHealth(target: SourceHealthContext): void {
  Object.assign(target, buildSourceHealthFrom(target));
}

attachSourceHealth.buildFrom = buildSourceHealthFrom;

export default attachSourceHealth;
