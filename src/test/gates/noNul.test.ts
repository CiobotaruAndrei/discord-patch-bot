import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findNulBytes } from "../../scripts/check-no-nul.js";

test("no-NUL gate detects binary bytes in text files", () => {
  assert.deepEqual(findNulBytes([]), []);
});

test("seenRepository ramane fara NUL literal", () => {
  const repository = new URL("../../../features/notifications/seenRepository.ts", import.meta.url);
  assert.equal(new Uint8Array(requireBytes(repository)).includes(0), false);
});

function requireBytes(url: URL): Uint8Array {
  return new Uint8Array(fs.readFileSync(url));
}
