import test from "node:test";
import assert from "node:assert/strict";
import { createAuditCorrelation } from "../features/admin-records/auditCorrelation.js";

test("audit correlation keeps guild, request and operation ids linked", () => {
  assert.deepEqual(createAuditCorrelation("g1", "req-1"), { guildId: "g1", requestId: "req-1", operationId: "g1:req-1" });
});
