import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../infra/mongo/adminAlertContent") as typeof import("../infra/mongo/adminAlertContent");
const { getAlertGuidance, alertKindFamily, buildAdminAlertEmbed } = mod;

test("alertKindFamily extrage prefixul inainte de ':'", () => {
  assert.equal(alertKindFamily("drift:minecraft"), "drift");
  assert.equal(alertKindFamily("cb:fortnite"), "cb");
  assert.equal(alertKindFamily("http:listen"), "http");
  assert.equal(alertKindFamily("plainkind"), "plainkind");
});

test("getAlertGuidance: kind exact (boot:fatal) e fatal cu remediere proprie", () => {
  const g = getAlertGuidance("boot:fatal");
  assert.equal(g.severity, "fatal");
  assert.match(g.action, /MONGO_URI|DISCORD_TOKEN|log/i);
});

test("getAlertGuidance: boot:migrations e warning si pomeneste fail-fast/migrare", () => {
  const g = getAlertGuidance("boot:migrations");
  assert.equal(g.severity, "warning");
  assert.match(g.action, /MIGRATIONS_CONTINUE_ON_ERROR|migrar/i);
});

test("getAlertGuidance: kind dinamic foloseste familia (drift:<joc>)", () => {
  const g = getAlertGuidance("drift:some-game-key");
  assert.equal(g.severity, "warning");
  assert.match(g.meaning, /schema drift|HTML|API/i);
});

test("getAlertGuidance: familia cb si process", () => {
  assert.match(getAlertGuidance("cb:abc").meaning, /[Cc]ircuit breaker/);
  assert.match(getAlertGuidance("process:SIGTERM").action, /SIGTERM|stack|oprire/i);
});

test("getAlertGuidance: cron:lock e doar info (multi-instanta normal)", () => {
  assert.equal(getAlertGuidance("cron:lock").severity, "info");
});

test("getAlertGuidance: http:listen indruma catre env-ul real PORT, nu spre variabile inexistente", () => {
  const g = getAlertGuidance("http:listen");
  assert.match(g.action, /env PORT/, "ghidajul mentioneaza variabila reala PORT");
  assert.ok(!g.action.includes("HEALTH_PORT"), "regresie: ghidajul trimitea operatorul la HEALTH_PORT, variabila care nu exista in cod/.env.example");
});

test("getAlertGuidance: kind necunoscut => default warning", () => {
  const g = getAlertGuidance("ceva:necunoscut");
  assert.equal(g.severity, "warning");
  assert.equal(g.meaning, "Alerta de sistem.");
});

test("buildAdminAlertEmbed: are fields 'Ce inseamna' + 'Ce trebuie facut', culoare si footer cu kind+severity", () => {
  const now = new Date("2026-06-06T12:00:00.000Z");
  const payload = buildAdminAlertEmbed("boot:fatal", "Botul nu a putut porni", "ReferenceError: x", now);
  const embed = payload.embeds[0];
  assert.equal(embed.color, 0xe74c3c);
  assert.match(embed.title, /FATAL/);
  assert.match(embed.title, /Botul nu a putut porni/);
  assert.match(embed.description, /Cauza/);
  assert.match(embed.description, /ReferenceError: x/);
  const fieldNames = embed.fields.map(f => f.name);
  assert.deepEqual(fieldNames, ["Ce inseamna", "Ce trebuie facut"]);
  assert.match(embed.footer.text, /kind=boot:fatal/);
  assert.match(embed.footer.text, /severity=fatal/);
  assert.equal(embed.timestamp, now.toISOString());
});

test("buildAdminAlertEmbed: body gol => '(fara detalii)' si culoare warning pentru kind necunoscut", () => {
  const payload = buildAdminAlertEmbed("x:y", "T", null, new Date());
  assert.match(payload.embeds[0].description, /\(fara detalii\)/);
  assert.equal(payload.embeds[0].color, 0xe67e22);
});

test("buildAdminAlertEmbed: trunchiaza cauza foarte lunga la <= 1024 in field/description", () => {
  const longBody = "x".repeat(5000);
  const payload = buildAdminAlertEmbed("cron:fatal", "Eroare cron", longBody, new Date());
  const embed = payload.embeds[0];
  assert.ok(embed.description.length <= 4096);
  for (const field of embed.fields) assert.ok(field.value.length <= 1024);
});
