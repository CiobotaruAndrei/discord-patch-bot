import test from "node:test";
import assert from "node:assert/strict";
import { hasSensitiveUserAccess } from "../features/command-security/adminAccessResolver";

import attachEnv from "../shared/env";
import globalAccessCode from "../features/command-security/globalAccessCode";
import { adminCommandGuard as adminCommandRouterGuard } from "./adminGuardTestKit";

function makeEnvContext(): Record<string, unknown> {
  return {
    z: require("zod").z,
    logger: () => undefined,
    parseEnvNumber: (_name: string, defaultValue: number) => defaultValue,
    RAW_LOG_LEVEL: "INFO"
  };
}

test("shared/env parseaza BOT_SENSITIVE_USER_IDS ca lista si expune secretele de acces ca string-uri", () => {
  const keys = ["BOT_SENSITIVE_USER_IDS", "MONGO_URI", "DISCORD_TOKEN", "DISCORD_CLIENT_ID"] as const;
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  process.env.BOT_SENSITIVE_USER_IDS = " op-1 , op-2 ,,";
  process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/test-env";
  process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "token-test";
  process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "client-test";
  try {
    const { env } = attachEnv.buildFrom(makeEnvContext() as object as Parameters<typeof attachEnv.buildFrom>[0]);
    assert.deepEqual(env.BOT_SENSITIVE_USER_IDS, ["op-1", "op-2"]);
    assert.equal(typeof env.BOT_GLOBAL_ACCESS_CODE, "string");
    assert.equal(typeof env.BOT_GLOBAL_ACCESS_CODE_HASH, "string");
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("hasSensitiveUserAccess prefera allowlist-ul injectat prin env in fata lui process.env", () => {
  assert.equal(hasSensitiveUserAccess({ user: { id: "op-1" } }, { BOT_SENSITIVE_USER_IDS: ["op-1"] }), true);
  assert.equal(hasSensitiveUserAccess({ user: { id: "altcineva" } }, { BOT_SENSITIVE_USER_IDS: ["op-1"] }), false);
  assert.equal(hasSensitiveUserAccess({ user: { id: "oricine" } }, { BOT_SENSITIVE_USER_IDS: [] }), true);
});

test("verifyGlobalAccessCode accepta env injectat (nu doar process.env)", () => {
  assert.equal(globalAccessCode.verifyGlobalAccessCode("secret-123", { BOT_GLOBAL_ACCESS_CODE: "secret-123" }), "valid");
  assert.equal(globalAccessCode.verifyGlobalAccessCode("gresit", { BOT_GLOBAL_ACCESS_CODE: "secret-123" }), "invalid");
  assert.equal(globalAccessCode.verifyGlobalAccessCode("orice", {}), "not-configured");
});

test("guard-ul de comenzi sensibile citeste allowlist-ul din env-ul contextului, cu prioritate peste process.env", async () => {
  const replies: unknown[] = [];
  const interaction = {
    commandName: "reset-config",
    guild: { id: "guild-1" },
    user: { id: "altcineva" },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    memberPermissions: { has: () => true },
    options: { getSubcommand: () => "", getSubcommandGroup: () => null },
    reply: async (payload: unknown) => { replies.push(payload); },
    followUp: async (payload: unknown) => { replies.push(payload); }
  };
  const target = { env: { BOT_SENSITIVE_USER_IDS: ["op-1"] } };
  const guard = adminCommandRouterGuard.createAdminCommandGuard({ requireGuildAdmin: async () => true }, target);
  const delegated: string[] = [];
  const result = await guard.handleAdminProtectedCommand(interaction, [], async () => { delegated.push("next"); return "ok"; });
  assert.equal(result, undefined, "comanda sensibila e blocata desi process.env nu are allowlist (env-ul injectat are prioritate)");
  assert.deepEqual(delegated, [], "handler-ul urmator nu e apelat");
  assert.match(JSON.stringify(replies), /Access denied/);
});
