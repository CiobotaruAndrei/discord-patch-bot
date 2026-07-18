import test from "node:test";
import assert from "node:assert/strict";
import { analyzeThreatInput } from "../../features/command-security/threatPipeline.js";

test("threat pipeline keeps local suspicious, external partial and risky-file states distinct", () => {
  assert.equal(analyzeThreatInput({ content: "discord.gg/example" }).state, "suspicious");
  assert.equal(analyzeThreatInput({ attachments: [{ kind: "attachment", url: "https://x.test/a.zip", name: "a.zip" }] }).state, "risky-file");
  assert.equal(analyzeThreatInput({ attachments: [{ kind: "attachment", url: "https://x.test/a.txt", name: "a.txt" }] }).state, "partial");
});
