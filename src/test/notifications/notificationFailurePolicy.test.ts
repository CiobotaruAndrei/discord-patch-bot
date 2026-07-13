import test from "node:test";
import assert from "node:assert/strict";

import { planNotificationFailure } from "../../features/notifications/notificationFailurePolicy.js";

test("planNotificationFailure incrementeaza incercarile si cere requeue sub prag", () => {
  assert.deepEqual(planNotificationFailure(undefined, 3), { action: "requeue", attempts: 1 });
  assert.deepEqual(planNotificationFailure(0, 3), { action: "requeue", attempts: 1 });
  assert.deepEqual(planNotificationFailure(1, 3), { action: "requeue", attempts: 2 });
});

test("planNotificationFailure trece in dead-letter exact la atingerea pragului (max-attempts)", () => {
  assert.deepEqual(planNotificationFailure(2, 3), { action: "dead-letter", attempts: 3, cause: "max-attempts" });
  assert.deepEqual(planNotificationFailure(7, 3), { action: "dead-letter", attempts: 8, cause: "max-attempts" });
  assert.deepEqual(planNotificationFailure(0, 1), { action: "dead-letter", attempts: 1, cause: "max-attempts" }, "max 1 = fara reincercari, prima esuare e terminala");
});

test("planNotificationFailure trateaza eroarea permanenta ca terminala indiferent de incercari, dar tot incrementeaza contorul", () => {
  assert.deepEqual(planNotificationFailure(0, 5, true), { action: "dead-letter", attempts: 1, cause: "permanent" });
  assert.deepEqual(planNotificationFailure(3, 5, true), { action: "dead-letter", attempts: 4, cause: "permanent" });
});
