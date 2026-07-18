import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { collectArchitectureViolations } from "../../scripts/check-architecture-boundaries.js";

test("architecture boundary gate passes the current source tree", () => {
  assert.deepEqual(collectArchitectureViolations(path.resolve(process.cwd())), []);
});
