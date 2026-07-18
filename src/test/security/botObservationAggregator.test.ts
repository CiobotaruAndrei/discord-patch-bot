import test from "node:test";
import assert from "node:assert/strict";
import { createBotObservationAggregator } from "../../features/command-security/botObservationAggregator.js";

test("observation aggregator deduplicates audit ids and detects bursts per guild", () => {
  const aggregator = createBotObservationAggregator({ windowMs: 1000, burstThreshold: 2 });
  aggregator.record({ id: "1", guildId: "g1", kind: "threat", at: 100 });
  aggregator.record({ id: "1", guildId: "g1", kind: "threat", at: 100 });
  const snapshot = aggregator.record({ id: "2", guildId: "g1", kind: "new-account", at: 200 });
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.byKind.threat, 1);
  assert.equal(snapshot.burst, true);
  assert.equal(aggregator.snapshot("g1", 1201).total, 0);
});
