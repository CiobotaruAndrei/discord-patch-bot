import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import { installCommandChain, type ChainableCommandModule } from "../commandChainTestKit.js";
import assert from "node:assert/strict";

const installAutocomplete = require("../../features/command-handlers/autocompleteInteractionHandler").default as
  ChainableCommandModule & {
    createAutocompleteHandler?: (deps: unknown) => unknown;
    scoreGameAgainstInput?: (game: TestGame, input: string) => number;
  };

type TestGame = { key: string; name: string; aliases: string[] };
type AutocompleteChoice = { name: string; value: string };
type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: TestGame[]) => Promise<unknown>;
};

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
  strings?: Record<string, string>;
}) {
  const responses: AutocompleteChoice[][] = [];
  return {
    interaction: {
      commandName: opts.command || "latest",
      guild: opts.guildId ? { id: opts.guildId } : null,
      isAutocomplete: () => opts.isAutocomplete ?? true,
      isChatInputCommand: () => false,
      options: {
        getFocused: () => opts.focused ?? null,
        getSubcommand: () => opts.sub ?? null,
        getSubcommandGroup: () => opts.group ?? null,
        getString: (name: string) => opts.strings?.[name] ?? null
      },
      respond: async (choices: AutocompleteChoice[]) => { responses.push(choices); }
    },
    responses
  };
}

function makeContext(overrides: Partial<Record<string, unknown>> = {}) {
  const logs: Array<{ level: string; context: string; msg: string }> = [];
  const delegated: string[] = [];
  const context = {
    logger: (level: string, c: string, msg: string) => { logs.push({ level, context: c, msg }); },
    getGuildSettings: async (_id: string) => null,
    handleInteraction: async (interaction: { commandName: string }) => { delegated.push(interaction.commandName); },
    ...overrides
  };
  installCommandChain(context, [installAutocomplete] as object as ChainableCommandModule[]);
  return { context: context as typeof context & InteractionRuntime, logs, delegated };
}

test("autocomplete returns empty when focused option is not `joc`", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    focused: { name: "value", value: "something" }
  });
  await context.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1);
  assert.deepEqual(responses[0], []);
});

test("autocomplete suggests bot commands for /help command", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "help",
    focused: { name: "command", value: "dead" }
  });
  await context.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1);
  assert.ok(responses[0].some(choice => choice.value === "/outbox deadletters"));
});

test("autocomplete suggests bot commands for /snooze command fara comenzile de control", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "snooze",
    focused: { name: "command", value: "latest" }
  });
  await context.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1);
  assert.ok(responses[0].some(choice => choice.value === "/latest updates"));
  assert.ok(!responses[0].some(choice => choice.value === "/snooze"));
  assert.ok(!responses[0].some(choice => choice.value === "/unsnooze"));
});

test("autocomplete returns top matches sorted by score then alphabetically", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "latest",
    sub: "update",
    focused: { name: "joc", value: "d" }
  });
  await context.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1);

  const names = responses[0].map(choice => choice.name);
  assert.ok(names[0].startsWith("Dota 2"));
});

test("autocomplete uses game.key as value by default", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "latest",
    sub: "update",
    focused: { name: "joc", value: "cs" }
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0);
  assert.equal(choices[0].value, "cs2", "value trebuie sa fie game.key");
  assert.match(choices[0].name, /Counter-Strike 2.*cs2/);
});

test("autocomplete uses game.name as value for /dlc", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "dlc",
    focused: { name: "joc", value: "cs" }
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0);
  assert.equal(choices[0].value, "Counter-Strike 2", "value trebuie sa fie game.name pentru steam search");
});

test("autocomplete uses game.name as value for /latest pret", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "latest",
    sub: "pret",
    focused: { name: "joc", value: "fort" }
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.equal(choices[0].value, "Fortnite");
});

test("/deal-score foloseste game.name ca value (handler-ul cauta oferta dupa titlu, nu dupa cheie) (R[Major] #1)", async () => {
  const { context } = makeContext();
  const { interaction, responses } = makeInteraction({
    command: "deal-score",
    focused: { name: "game", value: "counter" }
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0);
  assert.equal(choices[0].value, "Counter-Strike 2", "value trebuie sa fie numele jocului, ca sa se potriveasca cu titlul ofertei");
});

test("/set remove games restricts pool to enabledGames + stale placeholders", async () => {
  const { context } = makeContext({
    getGuildSettings: async (_id: string) => ({ enabledGames: ["cs2", "ghost_game_no_longer_in_config"] })
  });
  const { interaction, responses } = makeInteraction({
    command: "set",
    group: "remove",
    sub: "games",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  const keys = choices.map(c => c.value);
  assert.ok(keys.includes("cs2"), "cheia activa trebuie sa apara");
  assert.ok(keys.includes("ghost_game_no_longer_in_config"), "cheia stale trebuie inclusa ca placeholder");

  const staleChoice = choices.find(c => c.value === "ghost_game_no_longer_in_config");
  assert.match(staleChoice!.name, /cheie stale/);

  assert.ok(!keys.includes("fortnite"));
  assert.ok(!keys.includes("dota2"));
});

test("/watchlist remove restricts pool to enabledGames + stale placeholders", async () => {
  const { context } = makeContext({
    getGuildSettings: async (_id: string) => ({ enabledGames: ["cs2", "ghost_game_no_longer_in_config"] })
  });
  const { interaction, responses } = makeInteraction({
    command: "watchlist",
    sub: "remove",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  const keys = choices.map(c => c.value);
  assert.ok(keys.includes("cs2"));
  assert.ok(keys.includes("ghost_game_no_longer_in_config"));
  assert.ok(!keys.includes("fortnite"));
});

test("/price-alert remove sugereaza doar jocurile care au alerte", async () => {
  const { context } = makeContext({
    getGuildSettings: async (_id: string) => ({
      priceAlerts: [
        { gameKey: "cs2" },
        { gameKey: "removed-game" }
      ]
    })
  });
  const { interaction, responses } = makeInteraction({
    command: "price-alert",
    sub: "remove",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  const keys = choices.map(choice => choice.value);
  assert.ok(keys.includes("cs2"));
  assert.ok(keys.includes("removed-game"));
  assert.ok(!keys.includes("fortnite"));
});

test("/remove watchlist (verb in fata) restrange pool-ul la enabledGames", async () => {
  const { context } = makeContext({
    getGuildSettings: async (_id: string) => ({ enabledGames: ["cs2", "ghost_game_no_longer_in_config"] })
  });
  const { interaction, responses } = makeInteraction({
    command: "remove",
    sub: "watchlist",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  const keys = (responses[0] as Array<{ value: string }>).map(c => c.value);
  assert.ok(keys.includes("cs2"));
  assert.ok(keys.includes("ghost_game_no_longer_in_config"));
  assert.ok(!keys.includes("fortnite"), "/remove watchlist foloseste pool-ul restrans, nu toate jocurile");
});

test("/remove price-alert (verb in fata) sugereaza doar jocurile cu alerte", async () => {
  const { context } = makeContext({
    getGuildSettings: async (_id: string) => ({ priceAlerts: [{ gameKey: "cs2" }, { gameKey: "removed-game" }] })
  });
  const { interaction, responses } = makeInteraction({
    command: "remove",
    sub: "price-alert",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  const keys = (responses[0] as Array<{ value: string }>).map(c => c.value);
  assert.ok(keys.includes("cs2"));
  assert.ok(keys.includes("removed-game"));
  assert.ok(!keys.includes("fortnite"));
});

test("/youtube videos show include optiunea toate si canalele urmarite", async () => {
  const { context } = makeContext({
    getGuildSettings: async () => ({
      youtubeChannels: [
        { channelId: "UC123", channelName: "Creator A" },
        { channelId: "UC456", channelName: "Creator B" }
      ]
    })
  });
  const { interaction, responses } = makeInteraction({
    command: "youtube",
    group: "videos",
    sub: "show",
    focused: { name: "canal", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  assert.deepEqual(responses[0].map(choice => choice.value), ["toate", "UC123", "UC456"]);
});

test("/youtube channel-route remove sugereaza toate si rutele canalului ales", async () => {
  const { context } = makeContext({
    getGuildSettings: async () => ({
      youtubeChannelRoutes: [{
        channelId: "UC123",
        discordChannelIds: ["123456789012345678", "987654321098765432"]
      }]
    })
  });
  const { interaction, responses } = makeInteraction({
    command: "youtube",
    group: "remove",
    sub: "channel-route",
    focused: { name: "discord", value: "" },
    guildId: "guild-1",
    strings: { canal: "UC123" }
  });
  await context.handleInteraction(interaction, GAMES);
  assert.deepEqual(
    responses[0].map(choice => choice.value),
    ["toate", "123456789012345678", "987654321098765432"]
  );
});

test("/youtube title-filter remove sugereaza numai valorile configurate", async () => {
  const { context } = makeContext({
    getGuildSettings: async () => ({
      youtubeTitleIncludeWords: ["patch notes", "update"]
    })
  });
  const { interaction, responses } = makeInteraction({
    command: "youtube",
    group: "remove",
    sub: "title-filter",
    focused: { name: "word", value: "patch" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  assert.deepEqual(responses[0], [{ name: "patch notes", value: "patch notes" }]);
});

test("/set games remove without guild context falls back to full games pool (no crash)", async () => {
  const { context, logs } = makeContext({
    getGuildSettings: async () => { throw new Error("trebuie sa nu fie apelat"); }
  });
  const { interaction, responses } = makeInteraction({
    command: "set",
    group: "games",
    sub: "remove",
    focused: { name: "joc", value: "" },
    guildId: null
  });
  await context.handleInteraction(interaction, GAMES);
  const choices = responses[0] as Array<{ name: string; value: string }>;
  assert.ok(choices.length > 0, "trebuie sa raspunda cu pool-ul default fara crash");
  assert.equal(logs.filter(l => /Nu am putut citi/.test(l.msg)).length, 0, "fara WARN inselator");
});

test("autocomplete falls back to default pool on getGuildSettings throw (logs WARN)", async () => {
  const { context, logs } = makeContext({
    getGuildSettings: async () => { throw new Error("mongo down"); }
  });
  const { interaction, responses } = makeInteraction({
    command: "set",
    group: "remove",
    sub: "games",
    focused: { name: "joc", value: "" },
    guildId: "guild-1"
  });
  await context.handleInteraction(interaction, GAMES);
  assert.equal(responses.length, 1, "trebuie sa raspunda cu fallback");
  assert.ok(logs.some(l => l.level === "WARN" && l.context === "AUTOCOMPLETE"));
});

test("non-autocomplete interactions are delegated to next handler", async () => {
  const { context, delegated } = makeContext();
  const { interaction } = makeInteraction({
    command: "ping",
    isAutocomplete: false,
    focused: null
  });
  await context.handleInteraction(interaction, GAMES);
  assert.deepEqual(delegated, ["ping"]);
});

test("respond rejection is swallowed (Discord side closed connection)", async () => {
  const { context } = makeContext();
  const interaction = {
    commandName: "latest",
    guild: null,
    isAutocomplete: () => true,
    isChatInputCommand: () => false,
    options: {
      getFocused: () => ({ name: "joc", value: "cs" }),
      getSubcommand: () => "update",
      getSubcommandGroup: () => null,
      getString: () => null
    },
    respond: async () => { throw new Error("Unknown interaction (10062)"); }
  };

  await context.handleInteraction(interaction, GAMES);
});

test("scoreGameAgainstInput: exact > prefix > contains > none", () => {
  const score = installAutocomplete.scoreGameAgainstInput;
  assert.ok(score, "scoreGameAgainstInput trebuie exportat pentru teste");
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "cs2"), 100);
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "counter"), 50);
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "strike"), 20);
  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, "xyz"), -1);

  assert.equal(score({ key: "cs2", name: "Counter-Strike 2", aliases: ["cs"] }, ""), 0);
});
