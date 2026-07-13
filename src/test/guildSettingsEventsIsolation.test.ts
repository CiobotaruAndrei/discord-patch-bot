import test from "node:test";
import assert from "node:assert/strict";
import {
  publishGuildSettingsChanged,
  subscribeGuildSettingsChanged,
  setGuildSettingsEventErrorReporter
} from "../infra/mongo/guildSettingsEvents.js";

test("un listener care arunca nu blocheaza publish-ul si nu opreste ceilalti listeneri", () => {
  const seen: string[] = [];
  const reported: Array<{ guildId: string; error: unknown }> = [];
  setGuildSettingsEventErrorReporter((guildId, error) => reported.push({ guildId, error }));
  const un1 = subscribeGuildSettingsChanged(() => { throw new Error("listener stricat"); });
  const un2 = subscribeGuildSettingsChanged((guildId) => seen.push(guildId));
  assert.doesNotThrow(() => publishGuildSettingsChanged("g1"));
  assert.deepEqual(seen, ["g1"], "listenerul sanatos ruleaza chiar daca primul arunca");
  assert.equal(reported.length, 1);
  assert.equal(reported[0].guildId, "g1");
  assert.match(String((reported[0].error as Error).message), /listener stricat/);
  un1(); un2();
  setGuildSettingsEventErrorReporter(() => undefined);
});

test("un reporter care arunca este inghitit (publish-ul nu poate esua din cauza raportarii)", () => {
  setGuildSettingsEventErrorReporter(() => { throw new Error("reporter stricat"); });
  const un = subscribeGuildSettingsChanged(() => { throw new Error("boom"); });
  assert.doesNotThrow(() => publishGuildSettingsChanged("g2"));
  un();
  setGuildSettingsEventErrorReporter(() => undefined);
});

test("scrierea Mongo nu e raportata ca esuata de un listener stricat (semantica post-write)", () => {
  const un = subscribeGuildSettingsChanged(() => { throw new Error("cache invalidation blew up"); });
  const writes: string[] = [];
  const simulatedPostWriteHook = (guildId: string) => {
    writes.push(guildId);
    publishGuildSettingsChanged(guildId);
  };
  assert.doesNotThrow(() => simulatedPostWriteHook("g3"));
  assert.deepEqual(writes, ["g3"], "scrierea ramane reusita, esecul listenerului nu se propaga la apelant");
  un();
});
