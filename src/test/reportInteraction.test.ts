import test from "node:test";
import assert from "node:assert/strict";

const mod = require("../features/command-handlers/reportInteractionHandler") as typeof import("../features/command-handlers/reportInteractionHandler") & {
  buildReportConfirmEmbed: (record: ReportRecord) => { title: string; description: string; color: number };
  buildReportAlertBody: (record: ReportRecord) => string;
};
const { buildReportConfirmEmbed, buildReportAlertBody } = mod;

interface ReportRecord { guildId: string; userId: string; type: string; gameKey: string; detail: string; createdAt: Date; }

const base: ReportRecord = { guildId: "g1", userId: "u1", type: "sursa-stricata", gameKey: "minecraft", detail: "Nu mai vin update-uri de 2 saptamani", createdAt: new Date() };

test("buildReportConfirmEmbed multumeste si reda tipul + detaliile", () => {
  const embed = buildReportConfirmEmbed(base);
  assert.match(embed.title, /Multumesc/);
  assert.match(embed.description, /Sursa stricata/);
  assert.match(embed.description, /minecraft/);
  assert.match(embed.description, /Nu mai vin update-uri/);
  assert.equal(embed.color, 0x2ecc71);
});

test("buildReportConfirmEmbed omite joc/detalii cand lipsesc", () => {
  const embed = buildReportConfirmEmbed({ ...base, gameKey: "", detail: "" });
  assert.doesNotMatch(embed.description, /Joc:/);
  assert.doesNotMatch(embed.description, /Detalii:/);
});

test("buildReportAlertBody include server, utilizator, tip, joc si detalii", () => {
  const body = buildReportAlertBody(base);
  assert.match(body, /Server: g1/);
  assert.match(body, /Utilizator: u1/);
  assert.match(body, /Tip: Sursa stricata/);
  assert.match(body, /Joc: minecraft/);
  assert.match(body, /Detalii: Nu mai vin update-uri/);
});
