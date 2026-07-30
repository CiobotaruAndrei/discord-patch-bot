import test from "node:test";
import assert from "node:assert/strict";
import { createGuildSettingsEventBus } from "../infra/mongo/guildSettingsEventBus.js";
import type { GuildSettingsChangedListener, GuildSettingsEventErrorReporter, GuildSettingsEventMetrics, GuildSettingsRemotePublisher } from "../infra/mongo/guildSettingsEventBus.js";

let bus = createGuildSettingsEventBus();

function freshBus(): void {
  bus.dispose();
  bus = createGuildSettingsEventBus();
}

const publishGuildSettingsChanged = (guildId: string): void => bus.publish(guildId);
const subscribeGuildSettingsChanged = (listener: GuildSettingsChangedListener): (() => void) => bus.subscribe(listener);
const setGuildSettingsEventErrorReporter = (reporter: GuildSettingsEventErrorReporter): void => bus.setErrorReporter(reporter);
const setGuildSettingsRemotePublisher = (publisher: GuildSettingsRemotePublisher | null): void => bus.setRemotePublisher(publisher);
const attachGuildSettingsEventMetrics = (target: GuildSettingsEventMetrics | null): void => bus.attachMetrics(target);

test("fiecare test isi ia magistrala lui: un listener care arunca nu blocheaza publish-ul si nu opreste ceilalti listeneri", () => {
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

test("esecul unui listener e numarat in metrica chiar daca si reporterul arunca (fallback garantat no-throw, review nou #17)", () => {
  const counters = { guildSettingsListenerFailures: 0 };
  attachGuildSettingsEventMetrics(counters);
  setGuildSettingsEventErrorReporter(() => { throw new Error("reporter stricat"); });
  const originalConsoleError = console.error;
  const fallbackLogs: unknown[][] = [];
  console.error = (...args: unknown[]) => { fallbackLogs.push(args); };
  const un = subscribeGuildSettingsChanged(() => { throw new Error("listener stricat"); });
  try {
    assert.doesNotThrow(() => publishGuildSettingsChanged("g4"));
    assert.equal(counters.guildSettingsListenerFailures, 1, "metrica e incrementata INAINTE de reporter, deci esecul e numarat chiar cu reporterul cazut");
    assert.equal(fallbackLogs.length, 1, "eroarea nu mai dispare: fallback-ul console.error o logheaza cand reporterul arunca");
    assert.match(String(fallbackLogs[0][0]), /g4/, "fallback-ul identifica guild-ul afectat");
  } finally {
    console.error = originalConsoleError;
    un();
    setGuildSettingsEventErrorReporter(() => undefined);
    attachGuildSettingsEventMetrics(null);
  }
});

test("esecul publisher-ului remote e numarat in aceeasi metrica (Redis cazut nu mai e invizibil)", () => {
  const counters = { guildSettingsListenerFailures: 0 };
  attachGuildSettingsEventMetrics(counters);
  const reported: string[] = [];
  setGuildSettingsEventErrorReporter(guildId => { reported.push(guildId); });
  setGuildSettingsRemotePublisher(() => { throw new Error("redis cazut"); });
  try {
    assert.doesNotThrow(() => publishGuildSettingsChanged("g5"));
    assert.equal(counters.guildSettingsListenerFailures, 1);
    assert.deepEqual(reported, ["g5"], "reporterul sanatos primeste eroarea publisher-ului remote");
  } finally {
    setGuildSettingsRemotePublisher(null);
    setGuildSettingsEventErrorReporter(() => undefined);
    attachGuildSettingsEventMetrics(null);
  }
});

test("fara metrics atasate (worker inainte de boot complet), esecul listenerului tot nu se propaga", () => {
  attachGuildSettingsEventMetrics(null);
  const reported: string[] = [];
  setGuildSettingsEventErrorReporter(guildId => { reported.push(guildId); });
  const un = subscribeGuildSettingsChanged(() => { throw new Error("boom"); });
  try {
    assert.doesNotThrow(() => publishGuildSettingsChanged("g6"));
    assert.deepEqual(reported, ["g6"]);
  } finally {
    un();
    setGuildSettingsEventErrorReporter(() => undefined);
  }
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
