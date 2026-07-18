import test from "node:test";
import assert from "node:assert/strict";

import { createNewAccountAlertDedup } from "../../features/command-security/newAccountAlertDedup.js";

test("markNewAccountAlerted: prima aparitie (upsert) => true, urmatoarele => false (audit, #19)", async () => {
  const store = new Set<string>();
  const model = {
    updateOne: async (filter: Record<string, unknown>) => {
      const key = `${filter.guildId}:${filter.userId}`;
      if (store.has(key)) return { upsertedCount: 0 };
      store.add(key);
      return { upsertedCount: 1 };
    }
  };
  const mark = createNewAccountAlertDedup(model);

  assert.equal(await mark("guild-1", "user-1"), true, "prima alerta pentru user-1");
  assert.equal(await mark("guild-1", "user-1"), false, "user-1 e deja alertat, nu se re-alerteaza");
  assert.equal(await mark("guild-1", "user-2"), true, "alt utilizator produce alerta");
  assert.equal(await mark("guild-2", "user-1"), true, "acelasi user in alt guild produce alerta");
});

test("markNewAccountAlerted: fara guild sau user => false; eroare de model => fail-open true (audit, #19)", async () => {
  const failing = createNewAccountAlertDedup({ updateOne: async () => { throw new Error("mongo down"); } });
  assert.equal(await failing("", "user-1"), false, "fara guildId nu se alerteaza");
  assert.equal(await failing("guild-1", ""), false, "fara userId nu se alerteaza");
  assert.equal(await failing("guild-1", "user-1"), true, "la eroare de persistenta alerteaza (fail-open), nu suprima tacit");
});
