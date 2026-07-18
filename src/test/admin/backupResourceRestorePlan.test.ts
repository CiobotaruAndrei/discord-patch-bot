import test from "node:test";
import assert from "node:assert/strict";

import {
  applyChannelIdRemap,
  planBackupChannelRestore
} from "../../features/admin-records/backupResourceRestorePlan.js";

test("planBackupChannelRestore: canalele care nu mai exista sunt marcate ca lipsa pentru creare, restul ca prezente (audit, #13)", () => {
  const snapshot = {
    notificationChannelId: "chan-updates",
    discountChannelId: "chan-deals-deleted",
    adminAlertChannelId: "chan-admin",
    dlcChannelId: null,
    subscribed: true
  };
  const existing = ["chan-updates", "chan-admin", "chan-other"];

  const plan = planBackupChannelRestore(snapshot, existing);

  assert.deepEqual(plan.missing, [{ field: "discountChannelId", oldId: "chan-deals-deleted" }]);
  assert.deepEqual(plan.present.map(item => item.field).sort(), ["adminAlertChannelId", "notificationChannelId"]);
});

test("planBackupChannelRestore: snapshot fara referinte de canal => plan gol (audit, #13)", () => {
  const plan = planBackupChannelRestore({ subscribed: true, currency: "EUR" }, []);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.present, []);
});

test("applyChannelIdRemap: inlocuieste ID-urile vechi cu cele noi (mapare dupa creare), pastreaza restul (audit, #13)", () => {
  const snapshot = {
    notificationChannelId: "chan-updates",
    discountChannelId: "chan-deals-deleted",
    subscribed: true,
    currency: "EUR"
  };
  const remap = new Map([["chan-deals-deleted", "chan-deals-new"]]);

  const restored = applyChannelIdRemap(snapshot, remap);

  assert.equal(restored.discountChannelId, "chan-deals-new", "canalul recreat primeste ID-ul nou");
  assert.equal(restored.notificationChannelId, "chan-updates", "canalele existente raman");
  assert.equal(restored.subscribed, true);
  assert.equal(restored.currency, "EUR");
  assert.equal(snapshot.discountChannelId, "chan-deals-deleted", "snapshot-ul original nu e mutat");
});
