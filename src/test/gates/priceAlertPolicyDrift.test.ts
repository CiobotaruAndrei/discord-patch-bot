import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CORE_CATALOG_HELP } from "../../features/command-catalog/coreCatalog.js";

test("anti-drift: politica /add price-alert (pregatire in avans) e sincronizata intre catalogul canonic si documentatia narativa (audit #6)", () => {
  const catalogEntry = CORE_CATALOG_HELP.find(entry => entry.command === "/add price-alert");
  assert.ok(catalogEntry, "catalogul /help contine /add price-alert");
  const catalogNote = (catalogEntry.notes ?? []).join(" ");
  assert.match(catalogNote, /canalul configurat prin \/start reduceri/, "catalogul descrie politica de pregatire in avans (foloseste canalul configurat), nu o preconditie stricta");

  const repoRoot = path.resolve(process.cwd(), "..");
  const narrative = fs.readFileSync(path.join(repoRoot, "docs", "Comenzi Functionalitate.md"), "utf8");
  const row = narrative.split("\n").find(line => line.includes("/add price-alert joc:"));
  assert.ok(row, "documentatia narativa contine randul /add price-alert");
  assert.doesNotMatch(row, /Necesita un canal activ/, "documentatia narativa NU mai declara canalul ca preconditie stricta (drift eliminat)");
  assert.match(row, /\/start reduceri/, "documentatia narativa mentioneaza acelasi mecanism /start reduceri ca sursa canalului");
  assert.match(row, /salvata chiar/i, "documentatia narativa declara explicit ca alerta e salvata fara canal activ (pregatire in avans)");
});
