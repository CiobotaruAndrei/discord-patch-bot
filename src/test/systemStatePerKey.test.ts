import test from "node:test";
import assert from "node:assert/strict";
import type { SystemTimes } from "../types";

const attachSystemState = require("../infra/mongo/systemState") as typeof import("../infra/mongo/systemState");
type SystemStateContext = Parameters<typeof attachSystemState>[0];

type SystemTimesKey = keyof SystemTimes;
type SystemUpdate = { $set: Record<string, number | SystemTimes> };
type SaveSystemTime = (key: SystemTimesKey, value: number) => Promise<void>;
type SystemStateRuntime = { saveSystemTime: SaveSystemTime };
type SystemStateTarget = SystemStateContext & Partial<SystemStateRuntime>;

function makeTarget() {
  const writes: SystemUpdate[] = [];
  const target: SystemStateTarget = {
    SystemModel: {
      findByIdAndUpdate(_id: string, update: SystemUpdate) {
        writes.push(update);
        return Promise.resolve(null);
      },
      findOneAndUpdate() {

        return { lean: async () => ({ _id: "system_state", executionTimes: { all: 1, single: 1, reduceri: 1 } }) };
      },
      findById: () => ({ lean: async () => ({ _id: "system_state", executionTimes: { all: 1, single: 1, reduceri: 1 } }) })
    }
  };
  attachSystemState(target);
  const runtime = target as SystemStateTarget & SystemStateRuntime;
  return { runtime, writes };
}

test("saveSystemTime writes a single dot-path field, not the whole executionTimes object", async () => {
  const { runtime, writes } = makeTarget();

  await runtime.saveSystemTime("single", 4321);

  assert.equal(writes.length, 1);
  const setDoc = writes[0].$set;
  assert.ok(setDoc, "expected a $set operator");
  assert.equal(setDoc["executionTimes.single"], 4321,
    "must target the dot-path so other keys are untouched");

  assert.equal(setDoc.executionTimes, undefined,
    "must not write the entire executionTimes object");
});

test("saveSystemTime ignores unknown keys and non-positive numbers", async () => {
  const { runtime, writes } = makeTarget();

  await (runtime.saveSystemTime as (key: string, value: number) => Promise<void>)("bogus", 100);
  await runtime.saveSystemTime("single", 0);
  await runtime.saveSystemTime("single", -10);
  await runtime.saveSystemTime("single", Number.NaN);
  await runtime.saveSystemTime("single", Number.POSITIVE_INFINITY);

  assert.equal(writes.length, 0,
    "invalid key or non-positive/non-finite value must not produce a Mongo write");
});

test("saveSystemTime accepts the three real keys", async () => {
  const { runtime, writes } = makeTarget();

  await runtime.saveSystemTime("all", 35000);
  await runtime.saveSystemTime("single", 2000);
  await runtime.saveSystemTime("reduceri", 10000);

  assert.equal(writes.length, 3);
  assert.equal(writes[0].$set["executionTimes.all"], 35000);
  assert.equal(writes[1].$set["executionTimes.single"], 2000);
  assert.equal(writes[2].$set["executionTimes.reduceri"], 10000);
});

type PauseTarget = SystemStateContext & Partial<{ getOutboxPaused: () => Promise<boolean>; setOutboxPaused: (paused: boolean) => Promise<void> }>;

function makePauseTarget(stored: boolean | undefined) {
  const writes: boolean[] = [];
  let value = stored;
  const target: PauseTarget = {
    SystemModel: {
      findById: () => ({ lean: async () => (value === undefined ? null : { _id: "system_state", outboxPaused: value }) }),
      findByIdAndUpdate: async (_id: string, update: { $set: { outboxPaused: boolean } }) => { value = update.$set.outboxPaused; writes.push(update.$set.outboxPaused); return null; },
      findOneAndUpdate: () => ({ lean: async () => ({ _id: "system_state" }) })
    }
  };
  attachSystemState(target);
  return { runtime: target as PauseTarget & { getOutboxPaused: () => Promise<boolean>; setOutboxPaused: (paused: boolean) => Promise<void> }, writes };
}

test("getOutboxPaused returns true only when the stored flag is exactly true", async () => {
  assert.equal(await makePauseTarget(true).runtime.getOutboxPaused(), true);
  assert.equal(await makePauseTarget(false).runtime.getOutboxPaused(), false);
  assert.equal(await makePauseTarget(undefined).runtime.getOutboxPaused(), false, "doc lipsa -> nu e pe pauza");
});

test("setOutboxPaused upserts the boolean flag and getOutboxPaused reflects it", async () => {
  const { runtime, writes } = makePauseTarget(false);
  await runtime.setOutboxPaused(true);
  assert.deepEqual(writes, [true]);
  assert.equal(await runtime.getOutboxPaused(), true, "dupa pause, flagul e citit ca true");
  await runtime.setOutboxPaused(false);
  assert.equal(await runtime.getOutboxPaused(), false);
});
