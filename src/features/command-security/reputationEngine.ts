"use strict";

import { createHash } from "node:crypto";
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

function normalizeBoundVerdict(value: unknown, expectedSha256: string): ReputationVerdict {
  if (typeof value !== "object" || value === null) return "unknown";
  const verdict = Reflect.get(value, "verdict");
  const contentSha256 = Reflect.get(value, "contentSha256");
  if (contentSha256 !== expectedSha256) return "unknown";
  return verdict === "malware"
    || verdict === "phishing"
    || verdict === "fraud"
    || verdict === "data-theft"
    || verdict === "exploit"
    || verdict === "clean"
    || verdict === "unknown"
    ? verdict
    : "unknown";
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
    if (!input.buffer) return "unknown";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const contentSha256 = createHash("sha256").update(input.buffer).digest("hex");
    try {
      const response = await httpReq("POST", endpoint, {
        timeout,
        data: {
          url: input.url ?? null,
          mime: input.mime,
          kind: input.kind,
          contentBase64: input.buffer.toString("base64"),
          contentLength: input.buffer.length,
          contentSha256
        },
        headers
      }, 0);
      if (typeof response.status === "number" && response.status >= 400) return "unknown";
      return normalizeBoundVerdict(response.data, contentSha256);
    } catch (err) {
      deps.logger?.("WARN", "THREAT_REPUTATION", "Apel esuat catre motorul de reputatie; verdict unknown", err);
      return "unknown";
    }
  };
}

export default { createReputationEngine, resolveReputationEngineStatus };
