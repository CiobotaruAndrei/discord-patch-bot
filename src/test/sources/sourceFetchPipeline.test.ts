import test from "node:test";
import assert from "node:assert/strict";
import { fetchDecodeNormalize } from "../../sources/sourceFetchPipeline.js";

test("source pipeline orders fetch, decode and domain normalization", async () => {
  const order: string[] = [];
  const result = await fetchDecodeNormalize(async () => { order.push("fetch"); return "42"; }, raw => { order.push("decode"); return Number(raw); }, value => { order.push("normalize"); return value + 1; });
  assert.equal(result, 43);
  assert.deepEqual(order, ["fetch", "decode", "normalize"]);
});
