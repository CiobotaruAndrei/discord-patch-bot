import test from "node:test";
import assert from "node:assert/strict";

import fs from "fs";
import path from "path";

const srcRoot = process.cwd();
const repoRoot = path.resolve(srcRoot, "..");
const roadmapPath = path.join(repoRoot, "ROADMAP.md");
const alertsPath = path.join(repoRoot, "monitoring", "prometheus-alerts.yml");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("ROADMAP.md documenteaza declansatorul batch-drain cu praguri concrete", () => {
  assert.ok(fs.existsSync(roadmapPath), "ROADMAP.md exista");
  const text = read(roadmapPath);
  assert.match(text, /claim in batch|bulkWrite/i, "descrie optimizarea de batch claim");
  assert.match(text, /bot_outbox_queue_depth/, "refera metrica de queue depth");
  assert.match(text, /bot_outbox_oldest_job_age_seconds/, "refera metrica de oldest job age");
  assert.match(text, /bot_outbox_last_drain_age_seconds/, "exclude cazul 'pe pauza' prin drain-age");
  assert.match(text, /500/, "prag concret pentru queue depth");
  assert.match(text, /900/, "prag concret pentru oldest job age (secunde)");
  assert.match(text, /2h/, "durata concreta pentru backlog cronic");
});

test("alerta OutboxBatchDrainRecommended exista si trimite la ROADMAP", () => {
  const text = read(alertsPath);
  assert.match(text, /alert:\s*OutboxBatchDrainRecommended/, "alerta de declansare exista");
  assert.match(text, /ROADMAP\.md/, "alerta trimite la ROADMAP.md");
  assert.match(text, /bot_outbox_queue_depth > 500/, "pragul din alerta e aliniat cu roadmap-ul");
  assert.match(text, /bot_outbox_last_drain_age_seconds < 120/, "alerta exclude cazul 'pe pauza'");
});
