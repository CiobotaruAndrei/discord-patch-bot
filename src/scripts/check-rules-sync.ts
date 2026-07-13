import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

export interface AlertRule {
  name: string;
  expr: string;
  severity: string;
  summary: string;
  metrics: string[];
}

export interface RulesSyncReport {
  rules: AlertRule[];
  missing: string[];
  malformed: string[];
  duplicateAlerts: string[];
  orphans: string[];
  pass: boolean;
}

const METRIC_RE = /bot_[a-z0-9_]+/g;

export function extractMetricNames(text: string): string[] {
  return Array.from(new Set(text.match(METRIC_RE) || []));
}

export function extractEmittedMetrics(httpServerSource: string): Set<string> {
  const names = new Set<string>();
  const re = /pushMetric\(lines, seenMetricNames, "([a-z_0-9]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(httpServerSource)) !== null) names.add(m[1]);
  return names;
}

export function parseAlertRules(yamlText: string): { rules: AlertRule[]; malformed: string[]; duplicateAlerts: string[] } {
  const lines = yamlText.split(/\r?\n/);
  const rules: AlertRule[] = [];
  let current: { name: string; expr?: string; severity?: string; summary?: string } | null = null;
  const flush = (): void => {
    if (!current) return;
    rules.push({
      name: current.name,
      expr: current.expr || "",
      severity: current.severity || "",
      summary: current.summary || "",
      metrics: extractMetricNames(current.expr || "")
    });
    current = null;
  };
  for (const line of lines) {
    const alertMatch = line.match(/^\s*-\s*alert:\s*(.+?)\s*$/);
    if (alertMatch) {
      flush();
      current = { name: alertMatch[1] };
      continue;
    }
    if (!current) continue;
    const exprMatch = line.match(/^\s*expr:\s*(.+?)\s*$/);
    if (exprMatch) { current.expr = exprMatch[1]; continue; }
    const severityMatch = line.match(/^\s*severity:\s*(.+?)\s*$/);
    if (severityMatch) { current.severity = severityMatch[1]; continue; }
    const summaryMatch = line.match(/^\s*summary:\s*["']?(.+?)["']?\s*$/);
    if (summaryMatch) { current.summary = summaryMatch[1]; continue; }
  }
  flush();
  const malformed: string[] = [];
  for (const rule of rules) {
    const missingFields: string[] = [];
    if (!rule.expr) missingFields.push("expr");
    if (!rule.severity) missingFields.push("severity");
    if (!rule.summary) missingFields.push("summary");
    if (missingFields.length > 0) malformed.push(`${rule.name || "(fara nume)"}: lipseste ${missingFields.join(", ")}`);
  }
  const counts = new Map<string, number>();
  for (const rule of rules) counts.set(rule.name, (counts.get(rule.name) || 0) + 1);
  const duplicateAlerts = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([name]) => name);
  return { rules, malformed, duplicateAlerts };
}

export function analyzeRulesSync(args: { alertsText: string; dashboardText: string; emitted: Set<string> }): RulesSyncReport {
  const { rules, malformed, duplicateAlerts } = parseAlertRules(args.alertsText);
  const referenced = new Set<string>([
    ...extractMetricNames(args.alertsText),
    ...extractMetricNames(args.dashboardText)
  ]);
  const missing = Array.from(referenced).filter(metric => !args.emitted.has(metric)).sort();
  const orphans = Array.from(args.emitted).filter(metric => !referenced.has(metric)).sort();
  const pass = missing.length === 0 && malformed.length === 0 && duplicateAlerts.length === 0;
  return { rules, missing, malformed, duplicateAlerts, orphans, pass };
}

function main(): void {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const srcRoot = process.cwd();
  const repoRoot = path.resolve(srcRoot, "..");
  const alertsText = fs.readFileSync(path.join(repoRoot, "monitoring", "prometheus-alerts.yml"), "utf8");
  const dashboardText = fs.readFileSync(path.join(repoRoot, "monitoring", "grafana-dashboard.json"), "utf8");
  const httpServerSource = fs.readFileSync(path.join(srcRoot, "app", "health", "httpServer.ts"), "utf8");

  const emitted = extractEmittedMetrics(httpServerSource);
  const report = analyzeRulesSync({ alertsText, dashboardText, emitted });

  console.log(`Sincronizare reguli monitorizare: ${report.rules.length} alerte, ${emitted.size} metrici emise la /metrics.`);
  if (report.orphans.length > 0) {
    console.log(`Metrici emise fara alerta/panou (info, nu esec): ${report.orphans.join(", ")}`);
  }
  for (const metric of report.missing) {
    console.error(`::error::[check-rules-sync] alerta/dashboard refera o metrica neemisa la /metrics: ${metric}`);
  }
  for (const issue of report.malformed) {
    console.error(`::error::[check-rules-sync] regula de alerta incompleta: ${issue}`);
  }
  for (const name of report.duplicateAlerts) {
    console.error(`::error::[check-rules-sync] nume de alerta duplicat: ${name}`);
  }

  if (!report.pass) {
    console.error("check-rules-sync: regulile de monitorizare nu sunt sincronizate cu metricile emise.");
    process.exit(1);
  }
  console.log("check-rules-sync OK: fiecare alerta/panou refera o metrica reala si fiecare regula e completa.");
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}

export {};
