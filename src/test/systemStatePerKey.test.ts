import test from "node:test";
import assert from "node:assert/strict";

const attachSystemState = require("../infra/mongo/systemState") as (ctx: any) => void;

function makeCtx() {
  const writes: Array<Record<string, any>> = [];
  const ctx: any = {
    SystemModel: {
      findByIdAndUpdate(_id: string, update: Record<string, any>) {
        writes.push(update);
        return Promise.resolve(null);
      },
      findOneAndUpdate() {

        return { lean: async () => ({ _id: "system_state", executionTimes: { all: 1, single: 1, reduceri: 1 } }) };
      }
    }
  };
  attachSystemState(ctx);
  return { ctx, writes };
}

test("saveSystemTime writes a single dot-path field, not the whole executionTimes object", async () => {
  const { ctx, writes } = makeCtx();

  await ctx.saveSystemTime("single", 4321);

  assert.equal(writes.length, 1);
  const setDoc = writes[0].$set;
  assert.ok(setDoc, "expected a $set operator");
  assert.equal(setDoc["executionTimes.single"], 4321,
    "must target the dot-path so other keys are untouched");

  assert.equal(setDoc.executionTimes, undefined,
    "must not write the entire executionTimes object");
});

test("saveSystemTime ignores unknown keys and non-positive numbers", async () => {
  const { ctx, writes } = makeCtx();

  await ctx.saveSystemTime("bogus" as any, 100);
  await ctx.saveSystemTime("single", 0);
  await ctx.saveSystemTime("single", -10);
  await ctx.saveSystemTime("single", Number.NaN);
  await ctx.saveSystemTime("single", Number.POSITIVE_INFINITY);

  assert.equal(writes.length, 0,
    "invalid key or non-positive/non-finite value must not produce a Mongo write");
});

test("saveSystemTime accepts the three real keys", async () => {
  const { ctx, writes } = makeCtx();

  await ctx.saveSystemTime("all", 35000);
  await ctx.saveSystemTime("single", 2000);
  await ctx.saveSystemTime("reduceri", 10000);

  assert.equal(writes.length, 3);
  assert.equal(writes[0].$set["executionTimes.all"], 35000);
  assert.equal(writes[1].$set["executionTimes.single"], 2000);
  assert.equal(writes[2].$set["executionTimes.reduceri"], 10000);
});
