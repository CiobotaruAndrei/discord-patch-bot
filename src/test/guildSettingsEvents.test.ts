import test from "node:test";
import assert from "node:assert/strict";
import { publishGuildSettingsChanged, subscribeGuildSettingsChanged } from "../infra/mongo/guildSettingsEvents";

test("guild settings changed notifica toti abonatii cu guild-ul scris", () => {
  const calls: string[] = [];
  const unsubscribeFirst = subscribeGuildSettingsChanged(guildId => calls.push(`first:${guildId}`));
  const unsubscribeSecond = subscribeGuildSettingsChanged(guildId => calls.push(`second:${guildId}`));
  publishGuildSettingsChanged("guild-1");
  unsubscribeFirst();
  unsubscribeSecond();
  assert.deepEqual(calls, ["first:guild-1", "second:guild-1"]);
});

test("unsubscribe opreste invalidarile ulterioare", () => {
  const calls: string[] = [];
  const unsubscribe = subscribeGuildSettingsChanged(guildId => calls.push(guildId));
  unsubscribe();
  publishGuildSettingsChanged("guild-2");
  assert.deepEqual(calls, []);
});

