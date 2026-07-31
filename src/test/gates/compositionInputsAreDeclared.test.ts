import test from "node:test";
import assert from "node:assert/strict";

import { loadModule, calls } from "./sourceStructureQueries.js";

const registry = loadModule("features", "command-registry", "commandRegistry.ts");

const SLICED = [
  "createDealPriceHistoryService",
  "attachCommandCache.createCommandCache",
  "attachPlayerCountSnapshots.createPlayerCountSnapshotService",
  "createReviewTrendSnapshotService",
  "attachFeedbackRepository.createFeedbackRepository",
  "createReportRepository",
  "attachSlashCommandDefinitions.createSlashCommandDefinitions"
];

const NEINCA_SLICED = ["attachCommandPresentation.createCommandPresentation", "attachNotifications.createNotificationRuntime"];

test("etapele de compunere primesc felia lor declarata, nu obiectul acumulat", () => {
  const wholeObject: string[] = [];
  for (const factory of SLICED) {
    const call = calls(registry).find(entry => entry.callee === factory);
    assert.ok(call, `${factory} se apeleaza din registru`);
    if (!call?.args.some(argument => argument.startsWith("pickDeclaredKeys("))) wholeObject.push(factory);
  }
  assert.deepEqual(
    wholeObject,
    [],
    "un factory care primeste tot contextul acumulat poate ajunge maine la orice serviciu adaugat inaintea lui, fara ca " +
      `nimeni sa observe; felia declarata face dependinta vizibila si verificata la compilare: ${wholeObject.join(", ")}`
  );
});

test("etapele inca ne-feliate sunt numite, nu uitate", () => {
  for (const factory of NEINCA_SLICED) {
    const call = calls(registry).find(entry => entry.callee === factory);
    assert.ok(call, `${factory} se apeleaza din registru`);
    assert.ok(
      !call?.args.some(argument => argument.startsWith("pickDeclaredKeys(")),
      `${factory} a fost feliat: muta-l in lista de sus, ca gate-ul sa il pastreze asa`
    );
  }
  assert.equal(
    NEINCA_SLICED.length,
    2,
    "prezentarea si runtime-ul de notificari isi declara dependintele in contracte proprii, de ordinul zecilor de chei; " +
      "feliile lor sunt pasul urmator, iar lista asta poate doar sa scada"
  );
});
