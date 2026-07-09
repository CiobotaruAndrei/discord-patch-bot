import test from "node:test";
import assert from "node:assert/strict";

import { renderBackupList, renderBackupPreview } from "../features/command-handlers/backupViews";
import type { ConfigBackupRecord, GuildSettings } from "../features/../types";

function makeBackup(overrides: Partial<ConfigBackupRecord> = {}): ConfigBackupRecord {
  return {
    name: "prod",
    createdBy: "42",
    createdAt: new Date("2024-01-02T03:04:05Z"),
    snapshot: {},
    ...overrides
  } as ConfigBackupRecord;
}

test("renderBackupList: lista goala -> mesaj dedicat", () => {
  assert.match(renderBackupList([]), /Nu exista backup-uri/);
});

test("renderBackupList: enumera numele, autorul si data fiecarui backup", () => {
  const text = renderBackupList([
    makeBackup({ name: "alpha", createdBy: "1" }),
    makeBackup({ name: "beta", createdBy: "" })
  ]);
  assert.match(text, /`alpha`/);
  assert.match(text, /<@1>/);
  assert.match(text, /`beta`/);
  assert.match(text, /user necunoscut/);
});

test("renderBackupPreview: marcheaza setarile schimbate si cele care se vor sterge", () => {
  const backup = makeBackup({ name: "prod", snapshot: { minDiscountPercent: 50 } });
  const current: GuildSettings = { minDiscountPercent: 20, currency: "EUR" } as GuildSettings;
  const text = renderBackupPreview(backup, current);
  assert.match(text, /Preview backup `prod`/);
  assert.match(text, /minDiscountPercent/);
  assert.match(text, /se vor STERGE/);
});

test("renderBackupPreview: reda canalele si rolurile referite ca mentiuni", () => {
  const backup = makeBackup({
    snapshot: { notificationChannelId: "111", discountRoleId: "222" }
  });
  const text = renderBackupPreview(backup, null);
  assert.match(text, /<#111>/);
  assert.match(text, /<@&222>/);
});

test("renderBackupPreview: backup fara canale/roluri -> mesaj explicit", () => {
  const text = renderBackupPreview(makeBackup({ snapshot: {} }), null);
  assert.match(text, /nu contine canale sau roluri configurate/);
});
