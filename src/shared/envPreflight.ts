"use strict";

export const REQUIRED_ENV_VARS = ["MONGO_URI", "DISCORD_TOKEN", "DISCORD_CLIENT_ID"] as const;

export interface EnvPreflightReport {
  ok: boolean;
  missingRequired: string[];
  presentRequired: string[];
  warnings: string[];
}

export function evaluateEnvPreflight(env: Record<string, string | undefined>): EnvPreflightReport {
  const missingRequired: string[] = [];
  const presentRequired: string[] = [];
  for (const name of REQUIRED_ENV_VARS) {
    if (typeof env[name] === "string" && env[name]!.length > 0) presentRequired.push(name);
    else missingRequired.push(name);
  }

  const warnings: string[] = [];
  const hasCode = Boolean(env.BOT_GLOBAL_ACCESS_CODE);
  const hasCodeHash = Boolean(env.BOT_GLOBAL_ACCESS_CODE_HASH);
  if (hasCode && !hasCodeHash) {
    warnings.push("BOT_GLOBAL_ACCESS_CODE e setat in clar fara BOT_GLOBAL_ACCESS_CODE_HASH — preferabil configureaza hash-ul SHA-256 si scoate codul in clar (vezi README).");
  }
  if (!hasCode && !hasCodeHash) {
    warnings.push("Nici BOT_GLOBAL_ACCESS_CODE_HASH, nici BOT_GLOBAL_ACCESS_CODE nu sunt setate — fallback-ul de cod global pentru comenzile admin e dezactivat (owner-ul si Administrator raman singurele cai).");
  }
  if (!env.NODE_ENV) {
    warnings.push("NODE_ENV nu e setat — botul ruleaza cu comportamentul implicit non-production.");
  }
  if (!env.REDIS_URL) {
    warnings.push("REDIS_URL nu e setat — Redis/cache extern dezactivat.");
  }

  return { ok: missingRequired.length === 0, missingRequired, presentRequired, warnings };
}
