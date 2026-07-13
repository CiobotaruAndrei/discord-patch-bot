import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/healthInteractionHandler").default as typeof import("../features/command-handlers/healthInteractionHandler.js")["default"] & {
  buildHealthEmbed: (snapshot: HealthSnapshot) => { title: string; description: string; color: number; fields: Array<{ name: string; value: string }>; footer: { text: string } };
  formatUptime: (seconds: number) => string;
};
const { buildHealthEmbed, formatUptime } = mod;

type RedisStatus = "disabled" | "connected" | "disconnected";

interface HealthSnapshot {
  discordReady: boolean;
  discordPing: number;
  mongoReadyState: number;
  redisStatus: RedisStatus;
  cacheSizes: { single: number; dlc: number; [key: string]: number };
  uptimeSeconds: number;
}

const base: HealthSnapshot = { discordReady: true, discordPing: 42, mongoReadyState: 1, redisStatus: "disabled", cacheSizes: { single: 3, dlc: 1 }, uptimeSeconds: 90061 };

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

test("buildHealthEmbed: statusul Redis apare pe toate cele 3 stari, fara sa schimbe OK/degradat (Redis e optional)", () => {
  const disabled = buildHealthEmbed({ ...base, redisStatus: "disabled" });
  assert.match(disabled.description, /Redis: ⚪ dezactivat/);
  assert.match(disabled.title, /OK/, "Redis dezactivat NU degradeaza botul");
  assert.equal(disabled.color, 0x2ecc71);

  const connected = buildHealthEmbed({ ...base, redisStatus: "connected" });
  assert.match(connected.description, /Redis: 🟢 conectat/);
  assert.match(connected.title, /OK/);

  const disconnected = buildHealthEmbed({ ...base, redisStatus: "disconnected" });
  assert.match(disconnected.description, /Redis: 🔴 deconectat/);
  assert.match(disconnected.title, /OK/, "Redis deconectat NU degradeaza botul (Mongo+Discord sunt OK)");
});
