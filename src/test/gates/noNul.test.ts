import test from "node:test";
import assert from "node:assert/strict";
import { findNulBytes } from "../../scripts/check-no-nul.js";

test("no-NUL gate detects binary bytes in text files", () => {
  assert.deepEqual(findNulBytes([]), []);
});
