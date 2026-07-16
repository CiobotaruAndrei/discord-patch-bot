"use strict";

export interface PersistedEnvelope<K extends string = string, P = unknown> {
  kind: K;
  schemaVersion: number;
  payload: P;
}

export function encodePersistedEnvelope<K extends string, P>(kind: K, payload: P, schemaVersion = 1): PersistedEnvelope<K, P> {
  return { kind, schemaVersion, payload };
}

export function decodePersistedEnvelope<K extends string, P>(value: unknown, kind: K, decode: (payload: unknown) => P): PersistedEnvelope<K, P> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { kind?: unknown; schemaVersion?: unknown; payload?: unknown };
  if (candidate.kind !== kind || typeof candidate.schemaVersion !== "number" || !Number.isInteger(candidate.schemaVersion) || !("payload" in candidate)) return null;
  try {
    return { kind, schemaVersion: candidate.schemaVersion, payload: decode(candidate.payload) };
  } catch {
    return null;
  }
}
