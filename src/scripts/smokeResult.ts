import fs from "fs";

interface SmokeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

interface SmokeResult {
  kind: string;
  ok: boolean;
  skipped: boolean;
  timestamp: string;
  checks: SmokeCheck[];
}

function buildSmokeResult(kind: string, skipped: boolean, checks: SmokeCheck[], now: Date = new Date()): SmokeResult {
  return {
    kind,
    ok: skipped ? true : checks.every(check => check.ok),
    skipped,
    timestamp: now.toISOString(),
    checks
  };
}

function writeSmokeResult(envVar: string, result: SmokeResult): void {
  const file = (process.env[envVar] || "").trim();
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`[smoke] nu am putut scrie rezultatul in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export { buildSmokeResult, writeSmokeResult };
export type { SmokeCheck, SmokeResult };
