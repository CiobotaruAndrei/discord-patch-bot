import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

import attachSlashCommands from "../../features/command-definitions/slashCommandDefinitions.js";
import { SlashCommandBuilder } from "discord.js";
import type { CurrencyRegistry } from "../../types.js";

type SlashRuntime = {
  registerSlashCommands: (token: string, clientId: string) => Promise<void>;
};

const TEST_CURRENCIES: CurrencyRegistry = {
  USD: { cc: "US", symbol: "$", placement: "prefix" },
  EUR: { cc: "DE", symbol: "EUR", placement: "prefix" },
  GBP: { cc: "GB", symbol: "GBP", placement: "prefix" },
  RON: { cc: "RO", symbol: " lei", placement: "suffix" }
};

function makeContext(devGuildId?: string) {
  const calls: Array<{ route: string; bodyLength: number }> = [];
  const logs: Array<{ level: string; context: string; msg: string }> = [];
  const context: Parameters<typeof attachSlashCommands>[0] & Partial<SlashRuntime> = {
    SlashCommandBuilder,
    PermissionsBitField: { Flags: { Administrator: { toString: () => "8" } } },
    Routes: {
      applicationCommands: (clientId: string) => `/applications/${clientId}/commands`,
      applicationGuildCommands: (clientId: string, guildId: string) => `/applications/${clientId}/guilds/${guildId}/commands`
    },
    REST: class {
      constructor(_opts: { version: string }) {  }
      setToken(_token: string) {
        return {
          put: async (route: string, options: { body: unknown[] }) => {
            calls.push({ route, bodyLength: options.body.length });
            return undefined;
          }
        };
      }
    },
    SUPPORTED_CURRENCIES: TEST_CURRENCIES,
    logger: (level: string, c: string, msg: string) => { logs.push({ level, context: c, msg }); }
  };
  if (devGuildId !== undefined) {
    context.env = { DISCORD_DEV_GUILD_ID: devGuildId };
  }
  return { context: context as Parameters<typeof attachSlashCommands>[0] & SlashRuntime, calls, logs };
}

test("createSlashCommandDefinitions accepta builder-ul discord.js REAL fara cast (tip dep corect, nu Like scris de mana)", () => {
  const { SlashCommandBuilder, PermissionsBitField, Routes, REST } = require("discord.js") as typeof import("discord.js");
  const defs = attachSlashCommands.createSlashCommandDefinitions({
    SlashCommandBuilder,
    PermissionsBitField,
    Routes,
    REST,
    SUPPORTED_CURRENCIES: TEST_CURRENCIES,
    logger: () => undefined
  });
  const names = defs.buildSlashCommandDefinitions().map(d => String((d as { name?: unknown }).name || ""));
  assert.ok(names.includes("ping") && names.includes("start"), "factory-ul produce definitii reale cu builder-ul discord.js, fara as unknown as");
});

test("comenzile administrative (inclusiv /health) cer Administrator; cele publice raman deschise", () => {
  const { SlashCommandBuilder, PermissionsBitField, Routes, REST } = require("discord.js") as typeof import("discord.js");
  const defs = attachSlashCommands.createSlashCommandDefinitions({
    SlashCommandBuilder,
    PermissionsBitField,
    Routes,
    REST,
    SUPPORTED_CURRENCIES: TEST_CURRENCIES,
    logger: () => undefined
  });
  const adminFlag = PermissionsBitField.Flags.Administrator.toString();
  const byName = new Map<string, string | null | undefined>();
  const dmByName = new Map<string, boolean | undefined>();
  for (const d of defs.buildSlashCommandDefinitions()) {
    const json = d as { name?: string; default_member_permissions?: string | null; dm_permission?: boolean };
    byName.set(String(json.name || ""), json.default_member_permissions);
    dmByName.set(String(json.name || ""), json.dm_permission);
  }
  for (const adminCmd of [
    "start", "stop", "set", "outbox", "health", "config", "reset-config",
    "admin-alerts", "price-alert", "youtube", "sources", "watchlist", "snooze", "unsnooze",
    "backup", "bot-log", "server-log", "future-release", "maintenance", "admin-command-access", "delete"
  ]) {
    assert.equal(byName.get(adminCmd), adminFlag, `/${adminCmd} trebuie sa fie restrictionat la Administrator`);
    assert.equal(dmByName.get(adminCmd), false, `/${adminCmd} trebuie sa fie indisponibil in DM (dm_permission=false), ca sa nu ocoleasca guard-ul de admin`);
  }
  for (const [name, perms] of byName) {
    if (perms === adminFlag) {
      assert.equal(dmByName.get(name), false, `/${name} (admin) trebuie sa fie indisponibil in DM (dm_permission=false) - invariant pentru orice comanda admin noua`);
    }
  }
  for (const publicCmd of ["ping", "games", "help", "report", "price-check", "deal-score", "player-count", "top", "suggest-command", "watchlist-game"]) {
    assert.ok(
      byName.get(publicCmd) === null || byName.get(publicCmd) === undefined,
      `/${publicCmd} trebuie sa ramana public (fara default_member_permissions)`
    );
  }
});

test("registerSlashCommands defaults to global registration when DISCORD_DEV_GUILD_ID is unset", async () => {
  const { context, calls, logs } = makeContext();
  attachSlashCommands(context);

  await context.registerSlashCommands("test-token", "client-id-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/applications/client-id-1/commands");
  assert.ok(calls[0].bodyLength > 0, "must register at least one slash command");
  assert.ok(logs.some(l => l.context === "SLASH" && /global/.test(l.msg)),
    "log line must announce global registration");
});

test("registerSlashCommands switches to guild-scoped when DISCORD_DEV_GUILD_ID is set", async () => {
  const { context, calls, logs } = makeContext("123456789012345678");
  attachSlashCommands(context);

  await context.registerSlashCommands("test-token", "client-id-2");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/applications/client-id-2/guilds/123456789012345678/commands");
  assert.ok(calls[0].bodyLength > 0);
  assert.ok(logs.some(l => l.context === "SLASH" && /GUILD-scoped/.test(l.msg) && /123456789012345678/.test(l.msg)),
    "log line must call out the guild and 'GUILD-scoped' so operators know which mode is active");
});

test("registerSlashCommands falls back to global when DISCORD_DEV_GUILD_ID is empty string", async () => {

  const { context, calls, logs } = makeContext("");
  attachSlashCommands(context);

  await context.registerSlashCommands("test-token", "client-id-3");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/applications/client-id-3/commands");
  assert.ok(logs.some(l => /global/.test(l.msg)));
});
