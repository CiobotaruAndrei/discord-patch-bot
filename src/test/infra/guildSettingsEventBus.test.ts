import test from "node:test";
import assert from "node:assert/strict";

import { createGuildSettingsEventBus } from "../../infra/mongo/guildSettingsEventBus.js";

test("doua magistrale nu isi vad abonatii", () => {
  const a = createGuildSettingsEventBus();
  const b = createGuildSettingsEventBus();
  const primiteA: string[] = [];
  const primiteB: string[] = [];
  a.subscribe(id => primiteA.push(id));
  b.subscribe(id => primiteB.push(id));

  a.publish("g1");

  assert.deepEqual(primiteA, ["g1"]);
  assert.deepEqual(primiteB, [], "starea la nivel de modul facea ca un test sa lase abonati in urma pentru urmatorul");
});

test("dezabonarea chiar scoate abonatul", () => {
  const bus = createGuildSettingsEventBus();
  const primite: string[] = [];
  const unsubscribe = bus.subscribe(id => primite.push(id));

  bus.publish("g1");
  unsubscribe();
  bus.publish("g2");

  assert.deepEqual(primite, ["g1"]);
  assert.equal(bus.listenerCount(), 0);
});

test("un abonat care arunca nu opreste restul si e numarat", () => {
  const bus = createGuildSettingsEventBus();
  const metrics = { guildSettingsListenerFailures: 0 };
  bus.attachMetrics(metrics);
  const primite: string[] = [];

  bus.subscribe(() => { throw new Error("abonat stricat"); });
  bus.subscribe(id => primite.push(id));

  bus.publish("g1");

  assert.deepEqual(primite, ["g1"], "un abonat stricat nu are voie sa taie notificarea pentru ceilalti");
  assert.equal(metrics.guildSettingsListenerFailures, 1);
});

test("un publisher remote care arunca e raportat, nu propagat", () => {
  const bus = createGuildSettingsEventBus();
  const metrics = { guildSettingsListenerFailures: 0 };
  bus.attachMetrics(metrics);
  bus.setRemotePublisher(() => { throw new Error("redis picat"); });

  assert.doesNotThrow(() => bus.publish("g1"), "o cadere de Redis nu are voie sa rupa scrierea de setari");
  assert.equal(metrics.guildSettingsListenerFailures, 1);
});

test("dispose elibereaza abonatii si legaturile, ca oprirea sa fie curata", () => {
  const bus = createGuildSettingsEventBus();
  const primite: string[] = [];
  bus.subscribe(id => primite.push(id));
  bus.setRemotePublisher(() => primite.push("remote"));

  bus.dispose();
  bus.publish("g1");

  assert.deepEqual(primite, [], "dupa dispose nu mai ramane nimic atasat, deci procesul se poate opri fara referinte vii");
  assert.equal(bus.listenerCount(), 0);
});

test("dispatch local nu trece prin publisher-ul remote", () => {
  const bus = createGuildSettingsEventBus();
  let remote = 0;
  const primite: string[] = [];
  bus.setRemotePublisher(() => { remote += 1; });
  bus.subscribe(id => primite.push(id));

  bus.dispatchLocally("g1");

  assert.deepEqual(primite, ["g1"]);
  assert.equal(remote, 0, "un eveniment venit deja de la distanta nu trebuie retrimis, altfel se face bucla intre instante");
});
