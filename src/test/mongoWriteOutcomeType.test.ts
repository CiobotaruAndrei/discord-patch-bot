import test from "node:test";
import assert from "node:assert/strict";
import type { MongoWriteOutcome } from "../types";
import type { GuildConfigWriteResult } from "../features/guild-config/guildConfigRepository";
import type { MongoWriteResult } from "../features/command-handlers/subscriptionCommandContracts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

type _GuildConfigWriteResultIsShared = Expect<Same<GuildConfigWriteResult, MongoWriteOutcome>>;
type _SubscriptionWriteResultIsShared = Expect<Same<MongoWriteResult, MongoWriteOutcome>>;

test("MongoWriteOutcome: contract comun de rezultat de scriere Mongo, reutilizat (nu mai duplicat inline)", () => {
  const full: MongoWriteOutcome = { matchedCount: 1, modifiedCount: 1 };
  assert.equal(full.matchedCount, 1);
  assert.equal(full.modifiedCount, 1);
  const empty: MongoWriteOutcome = {};
  assert.deepEqual(empty, {}, "ambele campuri sunt optionale");
  assert.equal(true, true, "aserțiile de tip _*IsShared sunt compile-time: tsc pica daca vreun contract de scriere re-diverge de MongoWriteOutcome");
});
