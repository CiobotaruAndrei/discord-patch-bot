import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/healthInteractionHandler") as typeof import("../features/command-handlers/healthInteractionHandler") & {
  buildHealthEmbed: (snapshot: HealthSnapshot) => { title: string; description: string; color: number; fields: Array<{ name: string; value: string }>; footer: { text: string } };
  formatUptime: (seconds: number) => string;
};
const { buildHealthEmbed, formatUptime } = mod;

interface HealthSnapshot {
  discordReady: boolean;
  discordPing: number;
  mongoReadyState: number;
  cacheSizes: { single: number; dlc: number; [key: string]: number };
  uptimeSeconds: number;
}

const base: HealthSnapshot = { discordReady: true, discordPing: 42, mongoReadyState: 1, cacheSizes: { single: 3, dlc: 1 }, uptimeSeconds: 90061 };

test("formatUptime formateaza zile/ore/minute", () => {
  assert.equal(formatUptime(0), "0m");
  assert.equal(formatUptime(59), "0m");
  assert.equal(formatUptime(60), "1m");
  assert.equal(formatUptime(3600), "1h 0m");
  assert.equal(formatUptime(90061), "1z 1h 1m");
});

test("buildHealthEmbed: tot OK => verde, arata ping si cache", () => {
  const embed = buildHealthEmbed(base);
  assert.match(embed.title, /OK/);
  assert.equal(embed.color, 0x2ecc71);
  assert.match(embed.description, /Discord: 🟢 conectat \(ping 42ms\)/);
  assert.match(embed.description, /MongoDB: 🟢 conectat/);
  assert.ok(embed.fields.some(f => /single 3/.test(f.value) && /dlc 1/.test(f.value)));
  assert.match(embed.footer.text, /\/metrics/);
});

test("buildHealthEmbed: Mongo deconectat => degradat portocaliu", () => {
  const embed = buildHealthEmbed({ ...base, mongoReadyState: 0 });
  assert.match(embed.title, /degradat/);
  assert.equal(embed.color, 0xe67e22);
  assert.match(embed.description, /MongoDB: 🔴 deconectat/);
});

test("buildHealthEmbed: Discord neconectat => degradat, fara ping daca -1", () => {
  const embed = buildHealthEmbed({ ...base, discordReady: false, discordPing: -1 });
  assert.match(embed.title, /degradat/);
  assert.match(embed.description, /Discord: 🔴 neconectat/);
  assert.doesNotMatch(embed.description, /ping/);
});
