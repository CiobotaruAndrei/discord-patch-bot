import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const srcRoot = process.cwd();
const NOTIFICATIONS = path.join(srcRoot, "features", "notifications");

const SERVICES: readonly string[] = [
  "updateNotificationService.ts",
  "discountNotificationService.ts",
  "dlcNotificationService.ts"
];

function read(file: string): string {
  return fs.readFileSync(path.join(NOTIFICATIONS, file), "utf8");
}

test("toate cele trei servicii de notificare revendica prin acelasi nucleu", () => {
  for (const service of SERVICES) {
    const source = read(service);
    assert.match(source, /claimIntoBatch</, `${service} trebuie sa treaca prin claimIntoBatch`);
  }
});

test("niciun serviciu nu isi mai scrie propria bucla de revendicare", () => {
  const offenders: string[] = [];
  for (const service of SERVICES) {
    const source = read(service);
    for (const [index, line] of source.split("\n").entries()) {
      if (!/matchedDocument\(\s*claim/.test(line)) continue;
      offenders.push(`${service}:${index + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "citirea directa a rezultatului de revendicare inseamna ca serviciul si-a refacut bucla: " +
      `rollback-ul, dead-letter-ul si oprirea pe eroare permanenta trebuie sa vina din nucleu (${offenders.join(", ")})`
  );
});

test("fiecare serviciu isi scrie istoricul cu propriul tip de notificare", () => {
  const expected: Record<string, string> = {
    "updateNotificationService.ts": "update",
    "discountNotificationService.ts": "discount",
    "dlcNotificationService.ts": "dlc"
  };
  for (const [service, kind] of Object.entries(expected)) {
    const source = read(service);
    const historyBlock = source.slice(source.indexOf("historyEntryFor:"));
    assert.match(
      historyBlock,
      new RegExp(`kind: "${kind}"`),
      `${service} trebuie sa scrie istoricul cu kind "${kind}"; altfel /history nu mai distinge sursa notificarii`
    );
  }
});

test("nucleul acopera si rollback-ul, si politica de esec tranzitoriu", () => {
  const core = fs.readFileSync(path.join(NOTIFICATIONS, "notificationCycle.ts"), "utf8");
  for (const capability of ["rollback", "onTransientError", "transientPolicy", "onPermanentError", "remaining"]) {
    assert.ok(core.includes(capability), `nucleul expune ${capability}`);
  }
  assert.match(core, /if \(claimed\) await options\.rollback\(candidate\);/, "rollback-ul se face doar daca revendicarea chiar a reusit");
});
