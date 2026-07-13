import test from "node:test";
import assert from "node:assert/strict";

import {
  canUseGuildModel,
  commandAuditName,
  guildIdOf,
  hasSensitiveUserAccess,
  isGuildOwner,
  parseIdList
} from "../features/command-security/adminAccessResolver.js";
import type { GuildModelLike } from "../features/command-security/adminGuardContracts.js";

test("parseIdList imparte pe virgula, taie spatiile si arunca intrarile goale", () => {
  assert.deepEqual(parseIdList(" 1 , 2 ,, 3 "), ["1", "2", "3"]);
  assert.deepEqual(parseIdList(undefined), []);
  assert.deepEqual(parseIdList(""), []);
});

test("commandAuditName compune /comanda grup subcomanda si tolereaza options lipsa", () => {
  const interaction = {
    commandName: "youtube",
    options: {
      getSubcommandGroup: () => "filter",
      getSubcommand: () => "shorts"
    }
  };
  assert.equal(commandAuditName(interaction), "/youtube filter shorts");
  assert.equal(commandAuditName({ commandName: "config" }), "/config");
  assert.equal(commandAuditName({}), "/unknown");
});

test("hasSensitiveUserAccess: fara allowlist permite pe oricine, cu allowlist doar userii listati", () => {
  const previous = process.env.BOT_SENSITIVE_USER_IDS;
  try {
    delete process.env.BOT_SENSITIVE_USER_IDS;
    assert.equal(hasSensitiveUserAccess({ user: { id: "oricine" } }), true);
    process.env.BOT_SENSITIVE_USER_IDS = "111,222";
    assert.equal(hasSensitiveUserAccess({ user: { id: "111" } }), true);
    assert.equal(hasSensitiveUserAccess({ user: { id: "333" } }), false);
    assert.equal(hasSensitiveUserAccess({}), false);
  } finally {
    if (previous === undefined) delete process.env.BOT_SENSITIVE_USER_IDS;
    else process.env.BOT_SENSITIVE_USER_IDS = previous;
  }
});

test("isGuildOwner foloseste ownerId direct si cade pe fetchOwner cand lipseste", async () => {
  assert.equal(await isGuildOwner({ user: { id: "u1" }, guild: { id: "g", ownerId: "u1" } }), true);
  assert.equal(await isGuildOwner({ user: { id: "u2" }, guild: { id: "g", ownerId: "u1" } }), false);
  assert.equal(await isGuildOwner({
    user: { id: "u3" },
    guild: { id: "g", fetchOwner: async () => ({ user: { id: "u3" } }) }
  }), true);
  assert.equal(await isGuildOwner({ user: { id: "u4" } }), false);
});

test("canUseGuildModel si guildIdOf protejeaza citirile cand Mongo nu e conectat sau guild-ul lipseste", () => {
  const connected = { db: { readyState: 1 } } as GuildModelLike;
  const disconnected = { db: { readyState: 0 } } as GuildModelLike;
  assert.equal(canUseGuildModel(connected), true);
  assert.equal(canUseGuildModel(disconnected), false);
  assert.equal(canUseGuildModel(null), false);
  assert.equal(guildIdOf({ guild: { id: "g1" } }), "g1");
  assert.equal(guildIdOf({}), "");
});
