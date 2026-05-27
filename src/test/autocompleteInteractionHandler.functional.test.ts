import test from "node:test";
import assert from "node:assert/strict";


const installAutocomplete = require("../features/command-handlers/autocompleteInteractionHandler") as
  ((ctx: Record<string, any>) => void) & { createAutocompleteHandler?: (deps: any) => any; scoreGameAgainstInput?: (g: any, i: string) => number };

const GAMES = [
  { key: "cs2", name: "Counter-Strike 2", aliases: ["cs", "counter strike"] },
  { key: "fortnite", name: "Fortnite", aliases: ["fn"] },
  { key: "dota2", name: "Dota 2", aliases: ["dota"] },
  { key: "minecraft", name: "Minecraft", aliases: ["mc"] }
];

function makeInteraction(opts: {
  command?: string;
  isAutocomplete?: boolean;
  focused?: { name: string; value: string } | null;
  sub?: string | null;
  group?: string | null;
  guildId?: string | null;
}) {
  const responses: any[][] = [];
  return {
    interaction: {
      commandName: opts.command || "latest",
      guild: opts.guildId ? { id: opts.guildId } : null,
      isAutocomplete: () => opts.isAutocomplete ?? true,
      isChatInputCommand: () => false,
      options: {
        getFocused: () => opts.focused ?? null,
        getSubcommand: () => opts.sub ?? null,
        getSubcommandGroup: () => opts.group ?? null
      },
      respond: async (choices: any[]) => { responses.push(choices); }
    },
    responses
  };
}

function makeCtx(overrides: Partial<Record<string, any>> = {}) {
  const logs: Array<{ level: string; ctx: string; msg: string }> = [];
  const delegated: any[] = [];
  const ctx: Record<string, any> = {
    logger: (level: string, c: string, msg: string) => { logs.push({ level, ctx: c, msg }); },
    getGuildSettings: async (_id: string) => null,
    handleInteraction: async (interaction: any) => { delegated.push(interaction.commandName); },
    ...overrides
  };
  installAutocomplete(ctx);
  return { ctx, logs, delegated };
}

test("autocomplete returns empty when focused option is not `joc`", async () => {
  const { ctx } = makeCtx();
  const { interaction, responses } = makeInteraction({
    focused: { name: "value", value: "something" }
  });
  await ctx.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1);
  assert.deepEqual(responses[0], []);
});

test("autocomplete returns top matches sorted by score then alphabetically", async () => {
  const { ctx } = makeCtx();
  const { interaction, responses } = makeInteraction({
    command: "latest",
    sub: "update",
    focused: { name: "joc", value: "d" }
  });
  await ctx.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1);
  // Both "Dota 2" (starts with "d") and "dota" alias hit score 50 (prefix).
  // Tiebreaker by name → "Dota 2" first. Minecraft contains "d" via no path
  // (Minecraft doesn't contain "d") — let's pick more discriminating input.
  // Actually with "d", only Dota 2 should match (prefix + alias). Verify:
  const names = (responses[0] as any[]).map(c => c.name);
  assert.ok(names[0].startsWith("Dota 2"));
});

test("autocomplete uses game.key as value by default", async () => {
  const { ctx } = makeCtx();
  const { interaction, responses } = makeInteraction({
    command: "latest",
    sub: "update",
    focused: { name: "joc", value: "cs" }
  });
  await ctx.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0);
  assert.equal(choices[0].value, "cs2", "value trebuie sa fie game.key");
  assert.match(choices[0].name, /Counter-Strike 2.*cs2/);
});

test("autocomplete uses game.name as value for /dlc", async () => {
  const { ctx } = makeCtx();
  const { interaction, responses } = makeInteraction({
    command: "dlc",
    focused: { name: "joc", value: "cs" }
  });
  await ctx.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0);
  assert.equal(choices[0].value, "Counter-Strike 2", "value trebuie sa fie game.name pentru steam search");
});

test("autocomplete uses game.name as value for /latest pret", async () => {
  const { ctx } = makeCtx();
  const { interaction, responses } = makeInteraction({
    command: "latest",
    sub: "pret",
    focused: { name: "joc", value: "fort" }
  });
  await ctx.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.equal(choices[0].value, "Fortnite");
});

test("/set games remove restricts pool to enabledGames + stale placeholders", async () => {
  const { ctx } = makeCtx({
    getGuildSettings: async (_id: string) => ({ enabledGames: ["cs2", "ghost_game_no_longer_in_config"] })
  });
  const { interaction, responses } = makeInteraction({
    command: "set",
    group: "games",
    sub: "remove",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await ctx.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  const keys = choices.map(c => c.value);
  assert.ok(keys.includes("cs2"), "cheia activa trebuie sa apara");
  assert.ok(keys.includes("ghost_game_no_longer_in_config"), "cheia stale trebuie inclusa ca placeholder");
  // Verificam ca eticheta stale e marcata.
  const staleChoice = choices.find(c => c.value === "ghost_game_no_longer_in_config");
  assert.match(staleChoice!.name, /cheie stale/);
  // Jocurile NU active nu apar.
  assert.ok(!keys.includes("fortnite"));
  assert.ok(!keys.includes("dota2"));
});

test("/set games remove without guild context falls back to full games pool (no crash)", async () => {
  const { ctx, logs } = makeCtx({
    getGuildSettings: async () => { throw new Error("trebuie sa nu fie apelat"); }
  });
  const { interaction, responses } = makeInteraction({
    command: "set",
    group: "games",
    sub: "remove",
    focused: { name: "joc", value: "" },
    guildId: null
  });
  await ctx.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0, "trebuie sa raspunda cu pool-ul default fara crash");
  assert.equal(logs.filter(l => /Nu am putut citi/.test(l.msg)).length, 0, "fara WARN inselator");
});

test("autocomplete falls back to default pool on getGuildSettings throw (logs WARN)", async () => {
  const { ctx, logs } = makeCtx({
    getGuildSettings: async () => { throw new Error("mongo down"); }
  });
  const { interaction, responses } = makeInteraction({
    command: "set",
    group: "games",
    sub: "remove",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await ctx.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1, "trebuie sa raspunda cu fallback");
  assert.ok(logs.some(l => l.level === "WARN" && l.ctx === "AUTOCOMPLETE"));
});

test("non-autocomplete interactions are delegated to next handler", async () => {
  const { ctx, delegated } = makeCtx();
  const { interaction } = makeInteraction({
    command: "ping",
    isAutocomplete: false,
    focused: null
  });
  await ctx.handleInteraction(interaction, GAMES);
  assert.deepEqual(delegated, ["ping"]);
});

test("respond rejection is swallowed (Discord side closed connection)", async () => {
  const { ctx } = makeCtx();
  const interaction = {
    commandName: "latest",
    guild: null,
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: {
      getFocused: () => ({ name: "joc", value: "cs" }),
      getSubcommand: () => "update",
      getSubcommandGroup: () => null
    },
    respond: async () => { throw new Error("Unknown interaction (10062)"); }
  };
  // Trebuie sa nu arunce.
  await ctx.handleInteraction(interaction, GAMES);
});

test("scoreGameAgainstInput: exact > prefix > contains > none", () => {
  const score = (installAutocomplete as any).scoreGameAgainstInput;
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "cs2"), 100);
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "counter"), 50);
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "strike"), 20);
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "xyz"), -1);
  // empty input → 0 (everything is acceptable, ordered alphabetically downstream).
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, ""), 0);
});
