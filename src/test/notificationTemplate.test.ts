import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_NOTIFICATION_TEMPLATE_LENGTH,
  normalizeNotificationTemplate,
  renderNotificationTemplate,
  buildNotificationContent
} from "../features/notifications/notificationTemplate.js";

test("normalizeNotificationTemplate: trim, gol -> null, plafonat la lungime", () => {
  assert.equal(normalizeNotificationTemplate("  salut  "), "salut");
  assert.equal(normalizeNotificationTemplate(""), null);
  assert.equal(normalizeNotificationTemplate("   "), null);
  assert.equal(normalizeNotificationTemplate(null), null);
  assert.equal(normalizeNotificationTemplate(undefined), null);
  assert.equal(normalizeNotificationTemplate("x".repeat(600))?.length, MAX_NOTIFICATION_TEMPLATE_LENGTH);
});

test("renderNotificationTemplate: inlocuieste {count} (toate aparitiile), null pentru template gol", () => {
  assert.equal(renderNotificationTemplate("Au aparut {count} update-uri ({count})!", { count: 3 }), "Au aparut 3 update-uri (3)!");
  assert.equal(renderNotificationTemplate("fara placeholder", { count: 5 }), "fara placeholder");
  assert.equal(renderNotificationTemplate(null, { count: 3 }), null);
  assert.equal(renderNotificationTemplate("", { count: 3 }), null);
  assert.equal(renderNotificationTemplate("{count}", { count: -2 }), "0", "count negativ plafonat la 0");
});

test("buildNotificationContent: combina template randat + mentiune rol, cu allowedMentions doar cand exista rol", () => {
  assert.deepEqual(
    buildNotificationContent("Noi update-uri: {count}", { count: 2 }, "role-1"),
    { content: "Noi update-uri: 2 <@&role-1>", allowedMentions: { roles: ["role-1"] } }
  );
  assert.deepEqual(
    buildNotificationContent("Noi update-uri: {count}", { count: 2 }, null),
    { content: "Noi update-uri: 2" }
  );
  assert.deepEqual(
    buildNotificationContent(null, { count: 2 }, "role-1"),
    { content: "<@&role-1>", allowedMentions: { roles: ["role-1"] } },
    "fara template, doar mentiunea de rol (comportamentul vechi)"
  );
  assert.deepEqual(
    buildNotificationContent(null, { count: 2 }, null),
    {},
    "fara template si fara rol => niciun content (embed-uri simple)"
  );
});
