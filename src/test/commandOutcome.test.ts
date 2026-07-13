import test from "node:test";
import assert from "node:assert/strict";

import { handledCommandError, isHandledCommandError } from "../features/command-security/commandOutcome.js";

test("handledCommandError produce un marker recunoscut de isHandledCommandError (R[P2] audit)", () => {
  const marker = handledCommandError("mongo down");
  assert.equal(isHandledCommandError(marker), true);
  assert.equal(marker.reason, "mongo down");
});

test("isHandledCommandError respinge valori normale (undefined, mesaje, obiecte oarecare)", () => {
  assert.equal(isHandledCommandError(undefined), false);
  assert.equal(isHandledCommandError(null), false);
  assert.equal(isHandledCommandError("Access granted."), false);
  assert.equal(isHandledCommandError({ content: "ok" }), false);
  assert.equal(isHandledCommandError({ handledCommandError: false }), false);
});
