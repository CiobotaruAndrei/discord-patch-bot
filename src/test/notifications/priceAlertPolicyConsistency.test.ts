import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NOTIFICATIONS_CATALOG_HELP } from "../../features/command-catalog/notificationsCatalog.js";
import { PRICE_ALERT_PREPARATION_POLICY, formatPriceAlertActivationState, isPriceAlertDeliveryActive } from "../../features/notifications/priceAlertPolicy.js";
import type { GuildSettings, PriceAlertRule } from "../../types.js";

test("price-alert policy ramane sincronizata intre cod, catalog si documentatie", () => {
  const catalog = NOTIFICATIONS_CATALOG_HELP.find(entry => entry.command === "/price-alert list");
  assert.ok(catalog);
  assert.match(catalog.description, /inactiv/i);
  assert.match(catalog.description, /pregat/i);
  const readme = fs.readFileSync(path.join(process.cwd(), "..", "README.md"), "utf8");
  const functional = fs.readFileSync(path.join(process.cwd(), "..", "docs", "Comenzi Functionalitate.md"), "utf8");
  const reference = fs.readFileSync(path.join(process.cwd(), "..", "docs", "Referinta Comenzi.md"), "utf8");
  for (const document of [readme, functional, reference]) {
    assert.match(document, /inactiv/i);
    assert.match(document, /\/start reduceri/);
  }
  assert.match(PRICE_ALERT_PREPARATION_POLICY, /inactiv/i);
  const activeSettings: GuildSettings = { _id: "guild", discountsSubscribed: true, discountChannelId: "deals" };
  const inactiveSettings: GuildSettings = { _id: "guild", discountsSubscribed: false };
  const alert: PriceAlertRule = { gameKey: "game", gameName: "Game", threshold: 10, currency: "EUR", triggeredAt: null };
  assert.equal(isPriceAlertDeliveryActive(activeSettings), true);
  assert.equal(formatPriceAlertActivationState(inactiveSettings, alert), "inactiva, asteapta /start reduceri");
});
