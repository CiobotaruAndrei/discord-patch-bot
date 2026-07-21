"use strict";

import fs from "node:fs";
import path from "node:path";
import { getNativeFuzzy, recordNativeFallback } from "../../native/fuzzy.js";

export interface YaraMatch {
  rule: string;
  namespace: string;
  tags: string[];
  severity: string;
  description: string;
}

export interface YaraScanReport {
  status: "scanned" | "unavailable" | "error";
  reason: string;
  rulesetId: string;
  matches: YaraMatch[];
  truncated: boolean;
}

export interface YaraRulesetInfo {
  rulesetId: string;
  ruleCount: number;
  loaded: boolean;
  available: boolean;
}

export const YARA_SCAN_TIMEOUT_MS = 2_000;
export const YARA_MAX_MATCHES = 16;
const YARA_MAX_RULESET_BYTES = 8 * 1024 * 1024;

function unavailable(reason: string): YaraScanReport {
  return { status: "unavailable", reason, rulesetId: "", matches: [], truncated: false };
}

function readRulesetSource(rulesPath: string): string {
  const resolved = path.resolve(rulesPath);
  const stats = fs.statSync(resolved);
  if (stats.isFile()) {
    if (stats.size > YARA_MAX_RULESET_BYTES) throw new Error(`fisierul de reguli depaseste ${YARA_MAX_RULESET_BYTES} bytes`);
    return fs.readFileSync(resolved, "utf8");
  }
  const entries = fs.readdirSync(resolved)
    .filter(entry => entry.endsWith(".yar") || entry.endsWith(".yara"))
    .sort();
  if (entries.length === 0) throw new Error(`directorul ${resolved} nu contine fisiere .yar sau .yara`);
  let total = 0;
  const parts: string[] = [];
  for (const entry of entries) {
    const file = path.join(resolved, entry);
    total += fs.statSync(file).size;
    if (total > YARA_MAX_RULESET_BYTES) throw new Error(`setul de reguli depaseste ${YARA_MAX_RULESET_BYTES} bytes`);
    parts.push(fs.readFileSync(file, "utf8"));
  }
  return parts.join("\n");
}

export function loadYaraRuleset(
  rulesPath: string | undefined,
  logger?: (level: string, context: string, message: string, meta?: unknown) => void
): YaraRulesetInfo {
  const native = getNativeFuzzy();
  const info = native && typeof native.yaraRulesetInfo === "function" ? native.yaraRulesetInfo() : null;
  const available = info ? info.available === true : false;
  if (!available) {
    logger?.("INFO", "YARA", "Motorul YARA nu este disponibil in acest build; scanarea pe reguli este dezactivata");
    return { rulesetId: "", ruleCount: 0, loaded: false, available: false };
  }
  if (!rulesPath) {
    logger?.("INFO", "YARA", "Niciun set de reguli YARA configurat (YARA_RULES_PATH); scanarea pe reguli este inactiva");
    return { rulesetId: "", ruleCount: 0, loaded: false, available: true };
  }
  const loader = native && typeof native.loadYaraRules === "function" ? native.loadYaraRules : null;
  if (!loader) return { rulesetId: "", ruleCount: 0, loaded: false, available: true };
  try {
    const source = readRulesetSource(rulesPath);
    const loaded = loader.call(native, source);
    logger?.("INFO", "YARA", "Set de reguli YARA incarcat", { rulesetId: loaded.rulesetId, ruleCount: loaded.ruleCount });
    return { rulesetId: loaded.rulesetId, ruleCount: loaded.ruleCount, loaded: true, available: true };
  } catch (error) {
    logger?.("ERROR", "YARA", "Setul de reguli YARA nu a putut fi incarcat; setul anterior ramane activ, scanarea nu se opreste", {
      rulesPath,
      detail: error instanceof Error ? error.message : String(error)
    });
    const current = native && typeof native.yaraRulesetInfo === "function" ? native.yaraRulesetInfo() : null;
    return {
      rulesetId: current?.rulesetId ?? "",
      ruleCount: current?.ruleCount ?? 0,
      loaded: current?.loaded === true,
      available: true
    };
  }
}

export function yaraRulesetInfo(): YaraRulesetInfo {
  const native = getNativeFuzzy();
  if (!native || typeof native.yaraRulesetInfo !== "function") {
    return { rulesetId: "", ruleCount: 0, loaded: false, available: false };
  }
  const info = native.yaraRulesetInfo();
  return {
    rulesetId: String(info.rulesetId ?? ""),
    ruleCount: Number(info.ruleCount) || 0,
    loaded: info.loaded === true,
    available: info.available === true
  };
}

export async function scanWithYara(
  buffer: Buffer,
  timeoutMs: number = YARA_SCAN_TIMEOUT_MS,
  maxMatches: number = YARA_MAX_MATCHES
): Promise<YaraScanReport> {
  const native = getNativeFuzzy();
  const fn = native && typeof native.scanYara === "function" ? native.scanYara : null;
  if (!fn) return unavailable("addonul nativ nu expune scanarea YARA");
  try {
    const report = await fn.call(native, buffer, timeoutMs, maxMatches);
    if (report && (report.status === "scanned" || report.status === "unavailable" || report.status === "error")) {
      return {
        status: report.status,
        reason: String(report.reason ?? ""),
        rulesetId: String(report.rulesetId ?? ""),
        matches: Array.isArray(report.matches)
          ? report.matches.map(match => ({
            rule: String(match.rule ?? ""),
            namespace: String(match.namespace ?? ""),
            tags: Array.isArray(match.tags) ? match.tags.map(tag => String(tag)) : [],
            severity: String(match.severity ?? ""),
            description: String(match.description ?? "")
          }))
          : [],
        truncated: report.truncated === true
      };
    }
    recordNativeFallback("scanYara", new Error("raport YARA invalid"));
  } catch (error) {
    recordNativeFallback("scanYara", error);
  }
  return unavailable("scanarea YARA a esuat; verdictul local ramane neschimbat");
}

export function yaraIndicators(report: YaraScanReport): string[] {
  if (report.status !== "scanned" || report.matches.length === 0) return [];
  const indicators = report.matches.map(match => {
    const label = match.description || match.rule;
    const severity = match.severity ? ` (severitate ${match.severity})` : "";
    return `regula YARA ${match.rule}${severity}: ${label}`;
  });
  if (report.truncated) indicators.push("numarul de potriviri YARA a depasit plafonul raportat");
  return [...new Set(indicators)];
}

export default { loadYaraRuleset, scanWithYara, yaraIndicators, yaraRulesetInfo };
