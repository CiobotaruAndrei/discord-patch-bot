import { pathToFileURL as __pathToFileURL } from "node:url";
"use strict";

import { buildConfigSnapshot } from "../features/admin-records/configBackupRepository.js";
import type { GuildSettings } from "../features/guild-config/guildSettingsTypes.js";

export type GuildExportMode = "config" | "raw";

export interface GuildConfigExport {
  exportedAt: string;
  mode: GuildExportMode;
  guildCount: number;
  guilds: GuildSettings[];
}

export function resolveGuildExportMode(args: readonly string[]): GuildExportMode {
  if (args.length === 0) return "config";
  if (args.length === 1 && args[0] === "--raw") return "raw";
  throw new Error(`Argumente export invalide: ${args.join(" ")}`);
}

export function buildGuildConfigExport(
  docs: GuildSettings[],
  now: Date,
  mode: GuildExportMode = "config"
): GuildConfigExport {
  const guilds = mode === "raw"
    ? docs
    : docs.map(doc => ({ _id: doc._id, ...buildConfigSnapshot(doc) }));
  return {
    exportedAt: now.toISOString(),
    mode,
    guildCount: guilds.length,
    guilds
  };
}

export function exportFileName(now: Date, mode: GuildExportMode = "config"): string {
  const prefix = mode === "raw" ? "guild-documents-export" : "guild-configs-export";
  return `${prefix}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

async function main(): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const mongoose = await import("mongoose");
  const attachMongoModels = (await import("../infra/mongo/models.js")).default;

  const mode = resolveGuildExportMode(process.argv.slice(2));
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI lipseste — exportul cere o conexiune Mongo. Ruleaza cu .env: node --env-file=.env dist/scripts/export-guild-configs.js");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const models = attachMongoModels.buildFrom({
      mongoose,
      SUPPORTED_CURRENCIES: {
        USD: { cc: "US", symbol: "$", placement: "prefix" },
        EUR: { cc: "DE", symbol: "EUR", placement: "prefix" },
        GBP: { cc: "GB", symbol: "GBP", placement: "prefix" },
        RON: { cc: "RO", symbol: " lei", placement: "suffix" }
      },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000,
      env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, GUILD_AUDIT_LOG_TTL_DAYS: 180, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
    });
    const GuildModel = models.GuildModel as { find(filter: Record<string, unknown>): { lean(): Promise<GuildSettings[]> } };
    const now = new Date();
    const guilds = await GuildModel.find({}).lean();
    const exportDoc = buildGuildConfigExport(guilds, now, mode);
    const target = process.env.GUILD_EXPORT_PATH
      ? path.resolve(process.cwd(), process.env.GUILD_EXPORT_PATH)
      : path.resolve(process.cwd(), exportFileName(now, mode));
    fs.writeFileSync(target, JSON.stringify(exportDoc, null, 2));
    console.log(`Export ${mode} OK: ${exportDoc.guildCount} guild-uri scrise in ${target}`);
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

if (process.argv[1] !== undefined && __pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(err => { console.error(err); process.exit(1); });
}
