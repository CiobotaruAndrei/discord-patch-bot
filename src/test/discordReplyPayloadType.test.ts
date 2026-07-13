import test from "node:test";
import assert from "node:assert/strict";
import type { DiscordReplyPayload } from "../types.js";
import type { InteractionPayload } from "../features/command-handlers/subscriptionCommandContracts.js";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

type _InteractionPayloadIsShared = Expect<Same<InteractionPayload, DiscordReplyPayload>>;

test("DiscordReplyPayload: contract comun de payload de reply Discord (string sau obiect), reutilizat", () => {
  const asString: DiscordReplyPayload = "OK";
  const asObject: DiscordReplyPayload = { content: "salut", flags: 64 };
  assert.equal(typeof asString, "string");
  assert.equal((asObject as { content: string }).content, "salut");
  assert.equal(true, true, "aserțiunea _InteractionPayloadIsShared e compile-time: tsc pica daca payload-ul comun re-diverge de DiscordReplyPayload");
});
