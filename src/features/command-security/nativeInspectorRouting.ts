"use strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type IsolationSetting = "auto" | "on" | "off";

export interface IsolationInput {
  setting: IsolationSetting;
  platform: string;
  production: boolean;
  binaryPath: string | null;
}

export interface IsolationDecision {
  isolated: boolean;
  reason: string;
}

const DEFAULT_PROCESS_COUNT = 2;
const MAX_PROCESS_COUNT = 8;

export function readIsolationSetting(raw: string | undefined): IsolationSetting {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "on" || value === "true" || value === "1") return "on";
  if (value === "off" || value === "false" || value === "0") return "off";
  return "auto";
}

export function readProcessCount(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PROCESS_COUNT;
  return Math.min(parsed, MAX_PROCESS_COUNT);
}

export function decideIsolation(input: IsolationInput): IsolationDecision {
  if (input.setting === "off") {
    return { isolated: false, reason: "izolarea e oprita explicit prin NATIVE_INSPECTOR_ISOLATION" };
  }
  if (!input.binaryPath) {
    return { isolated: false, reason: "binarul native-inspector nu a fost gasit langa addon" };
  }
  if (input.setting === "on") {
    return { isolated: true, reason: "izolarea e ceruta explicit prin NATIVE_INSPECTOR_ISOLATION" };
  }
  if (input.platform !== "linux") {
    return { isolated: false, reason: `filtrul de syscall exista doar pe Linux, nu pe ${input.platform}` };
  }
  if (!input.production) {
    return { isolated: false, reason: "izolarea implicita e rezervata productiei (NODE_ENV=production)" };
  }
  return { isolated: true, reason: "productie Linux: inspectia ruleaza implicit in proces izolat" };
}

export function inspectorBinaryCandidates(moduleUrl: string, override: string | undefined): string[] {
  const explicit = String(override ?? "").trim();
  if (explicit) return [explicit];
  const here = path.dirname(fileURLToPath(moduleUrl));
  const executable = process.platform === "win32" ? "native-inspector.exe" : "native-inspector";
  const nativeRoot = path.resolve(here, "..", "..", "..", "native");
  return [
    path.join(nativeRoot, executable),
    path.join(nativeRoot, "target", "release", executable)
  ];
}

export function findInspectorBinary(candidates: readonly string[], exists: (file: string) => boolean = fs.existsSync): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}
