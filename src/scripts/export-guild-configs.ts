"use strict";

export interface GuildConfigExport {
  exportedAt: string;
  guildCount: number;
  guilds: Array<Record<string, unknown>>;
}

export function buildGuildConfigExport(docs: Array<Record<string, unknown>>, now: Date): GuildConfigExport {
  return {
    exportedAt: now.toISOString(),
    guildCount: docs.length,
    guilds: docs
  };
}

export function exportFileName(now: Date): string {
  return `guild-configs-export-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}

async function main(): Promise<void> {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const mongoose = require("mongoose") as {
    connect(uri: string, opts: Record<string, unknown>): Promise<unknown>;
    disconnect(): Promise<unknown>;
  };
  const attachMongoModels = require("../infra/mongo/models").default as { buildFrom: (target: Record<string, unknown>) => Record<string, unknown> };

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI lipseste — exportul cere o conexiune Mongo. Ruleaza cu .env: node --env-file=.env dist/scripts/export-guild-configs.js");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    const models = attachMongoModels.buildFrom({
      mongoose,
      SUPPORTED_CURRENCIES: { USD: {} },
      DEFAULT_CURRENCY: "USD",
      ONE_DAY_MS: 86_400_000,
      env: { GUILD_SEEN_DISCOUNT_TTL_DAYS: 60, NOTIFICATION_OUTBOX_SENT_TTL_HOURS: 24, NOTIFICATION_HISTORY_TTL_DAYS: 30, FEEDBACK_REPORT_TTL_DAYS: 90, NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS: 7 }
    });
    const GuildModel = models.GuildModel as { find(filter: Record<string, unknown>): { lean(): Promise<Array<Record<string, unknown>>> } };
    const now = new Date();
    const guilds = await GuildModel.find({}).lean();
    const exportDoc = buildGuildConfigExport(guilds, now);
    const target = process.env.GUILD_EXPORT_PATH
      ? path.resolve(process.cwd(), process.env.GUILD_EXPORT_PATH)
      : path.resolve(process.cwd(), exportFileName(now));
    fs.writeFileSync(target, JSON.stringify(exportDoc, null, 2));
    console.log(`Export OK: ${exportDoc.guildCount} guild-uri scrise in ${target}`);
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
