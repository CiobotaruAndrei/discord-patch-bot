"use strict";

import type { ReputationScan, ReputationVerdict, ReputationScanInput } from "./threatInspectionService.js";

type ReputationHttpResponse = { data?: unknown; status?: number };
type ReputationHttpRequest = (
  method: string,
  url: string,
  options?: Record<string, unknown>,
  retries?: number
) => Promise<ReputationHttpResponse>;

export interface ReputationEngineEnv {
  THREAT_REPUTATION_URL?: string;
  THREAT_REPUTATION_TOKEN?: string;
  THREAT_REPUTATION_TIMEOUT_MS?: number;
}

export interface ReputationEngineDeps {
  env: ReputationEngineEnv;
  httpReq?: ReputationHttpRequest;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
}

export interface ReputationEngineStatus {
  configured: boolean;
  reason: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TOKEN_LENGTH = 8;

function isHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveReputationEngineStatus(env: ReputationEngineEnv): ReputationEngineStatus {
  if (!env.THREAT_REPUTATION_URL) {
    return { configured: false, reason: "motor de reputatie/antivirus neconfigurat (THREAT_REPUTATION_URL absent)" };
  }
  if (!isHttpsUrl(env.THREAT_REPUTATION_URL)) {
    return { configured: false, reason: "THREAT_REPUTATION_URL nu este un URL https valid" };
  }
  if (env.THREAT_REPUTATION_TOKEN !== undefined && env.THREAT_REPUTATION_TOKEN.length < MIN_TOKEN_LENGTH) {
    return { configured: false, reason: "THREAT_REPUTATION_TOKEN este prea scurt" };
  }
  return { configured: true, reason: "motor de reputatie/antivirus configurat" };
}

function normalizeVerdict(value: unknown): ReputationVerdict {
  if (value === "malware" || value === "clean" || value === "unknown") return value;
  if (value && typeof value === "object" && "verdict" in value) {
    return normalizeVerdict((value as { verdict?: unknown }).verdict);
  }
  return "unknown";
}

export function createReputationEngine(deps: ReputationEngineDeps): ReputationScan | null {
  const status = resolveReputationEngineStatus(deps.env);
  if (!status.configured || !deps.httpReq) {
    if (deps.env.THREAT_REPUTATION_URL && !status.configured) {
      deps.logger?.("WARN", "THREAT_REPUTATION", "Motorul de reputatie e prezent dar invalid; protectia ramane doar euristica", status.reason);
    }
    return null;
  }
  const endpoint = deps.env.THREAT_REPUTATION_URL;
  if (!endpoint) return null;
  const token = deps.env.THREAT_REPUTATION_TOKEN;
  const timeout = deps.env.THREAT_REPUTATION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
  const httpReq = deps.httpReq;

  return async function reputationScan(input: ReputationScanInput): Promise<ReputationVerdict> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await httpReq("POST", endpoint, {
        timeout,
        data: { url: input.url ?? null, mime: input.mime, kind: input.kind, hasBytes: input.buffer !== null },
        headers
      }, 0);
      if (typeof response.status === "number" && response.status >= 400) return "unknown";
      return normalizeVerdict(response.data);
    } catch (err) {
      deps.logger?.("WARN", "THREAT_REPUTATION", "Apel esuat catre motorul de reputatie; verdict unknown", err);
      return "unknown";
    }
  };
}

export default { createReputationEngine, resolveReputationEngineStatus };
