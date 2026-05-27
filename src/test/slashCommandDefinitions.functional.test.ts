import test from "node:test";
import assert from "node:assert/strict";

type SlashCommandsInstaller = (ctx: Record<string, any>) => void;
const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as SlashCommandsInstaller;

class FakeSlashCommandBuilder {
  json: Record<string, any> = {};
  setName(name: string) { this.json.name = name; return this; }
  setDescription(desc: string) { this.json.desc = desc; return this; }
  setDefaultMemberPermissions(p: string) { this.json.perms = p; return this; }
  addSubcommand(cb: (b: FakeSlashCommandBuilder) => FakeSlashCommandBuilder) { cb(new FakeSlashCommandBuilder()); return this; }
  addSubcommandGroup(cb: (b: FakeSlashCommandBuilder) => FakeSlashCommandBuilder) { cb(new FakeSlashCommandBuilder()); return this; }
  addStringOption(cb: (b: FakeSlashCommandBuilder) => FakeSlashCommandBuilder) { cb(new FakeSlashCommandBuilder()); return this; }
  addIntegerOption(cb: (b: FakeSlashCommandBuilder) => FakeSlashCommandBuilder) { cb(new FakeSlashCommandBuilder()); return this; }
  addRoleOption(cb: (b: FakeSlashCommandBuilder) => FakeSlashCommandBuilder) { cb(new FakeSlashCommandBuilder()); return this; }
  addChoices(..._choices: unknown[]) { return this; }
  setRequired(_r: boolean) { return this; }
  setAutocomplete(_a: boolean) { return this; }
  setMinValue(_v: number) { return this; }
  setMaxValue(_v: number) { return this; }
  toJSON() { return this.json; }
}

function makeCtx(devGuildId?: string) {
  const calls: Array<{ route: string; bodyLength: number }> = [];
  const logs: Array<{ level: string; ctx: string; msg: string }> = [];
  const ctx: Record<string, any> = {
    SlashCommandBuilder: FakeSlashCommandBuilder,
    PermissionsBitField: { Flags: { Administrator: { toString: () => "8" } } },
    Routes: {
      applicationCommands: (clientId: string) => `/applications/${clientId}/commands`,
      applicationGuildCommands: (clientId: string, guildId: string) => `/applications/${clientId}/guilds/${guildId}/commands`
    },
    REST: class {
      constructor(_opts: { version: string }) { /* no-op */ }
      setToken(_token: string) {
        return {
          put: async (route: string, options: { body: unknown[] }) => {
            calls.push({ route, bodyLength: options.body.length });
            return undefined;
          }
        };
      }
    },
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: (level: string, c: string, msg: string) => { logs.push({ level, ctx: c, msg }); }
  };
  if (devGuildId !== undefined) {
    ctx.env = { DISCORD_DEV_GUILD_ID: devGuildId };
  }
  return { ctx, calls, logs };
}

test("registerSlashCommands defaults to global registration when DISCORD_DEV_GUILD_ID is unset", async () => {
  const { ctx, calls, logs } = makeCtx();
  attachSlashCommands(ctx);

  await ctx.registerSlashCommands("test-token", "client-id-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/applications/client-id-1/commands");
  assert.ok(calls[0].bodyLength > 0, "must register at least one slash command");
  assert.ok(logs.some(l => l.ctx === "SLASH" && /global/.test(l.msg)),
    "log line must announce global registration");
});

test("registerSlashCommands switches to guild-scoped when DISCORD_DEV_GUILD_ID is set", async () => {
  const { ctx, calls, logs } = makeCtx("123456789012345678");
  attachSlashCommands(ctx);

  await ctx.registerSlashCommands("test-token", "client-id-2");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/applications/client-id-2/guilds/123456789012345678/commands");
  assert.ok(calls[0].bodyLength > 0);
  assert.ok(logs.some(l => l.ctx === "SLASH" && /GUILD-scoped/.test(l.msg) && /123456789012345678/.test(l.msg)),
    "log line must call out the guild and 'GUILD-scoped' so operators know which mode is active");
});

test("registerSlashCommands falls back to global when DISCORD_DEV_GUILD_ID is empty string", async () => {
  // env.ts sets DISCORD_DEV_GUILD_ID to "" when not configured. Empty string
  // must NOT trigger guild-scoped registration.
  const { ctx, calls, logs } = makeCtx("");
  attachSlashCommands(ctx);

  await ctx.registerSlashCommands("test-token", "client-id-3");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/applications/client-id-3/commands");
  assert.ok(logs.some(l => /global/.test(l.msg)));
});
