import test from "node:test";
import assert from "node:assert/strict";

const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

type CanHandle = (interaction: unknown) => boolean;
type BuiltHandler = { canHandle: CanHandle };
type HandlerModule = { buildCommandHandler: (ctx: unknown) => BuiltHandler };

const deepStub: unknown = new Proxy({}, { get: () => deepStub });
const stubContext = deepStub;

function build(moduleName: string): BuiltHandler {
  const mod = require(`../features/command-handlers/${moduleName}`) as HandlerModule;
  return mod.buildCommandHandler(stubContext);
}

const handlers: Record<string, BuiltHandler> = {
  autocomplete: build("autocompleteInteractionHandler"),
  dlc: build("dlcInteractionHandler"),
  sources: build("sourcesStatusHandler"),
  config: build("configInteractionHandler"),
  guildConfigAdmin: build("guildConfigurationAdminHandler"),
  priceAlert: build("priceAlertInteractionHandler"),
  backup: build("backupInteractionHandler"),
  auditLog: build("auditLogInteractionHandler"),
  suggestCommand: build("suggestCommandInteractionHandler"),
  watchlistGame: build("watchlistGameSuggestionHandler"),
  futureRelease: build("futureReleaseInteractionHandler"),
  dealScore: build("dealScoreInteractionHandler"),
  maintenance: build("maintenanceInteractionHandler"),
  priceCheck: build("priceCheckInteractionHandler"),
  youtube: build("youtubeInteractionHandler"),
  snooze: build("snoozeInteractionHandler"),
  health: build("healthInteractionHandler"),
  report: build("reportInteractionHandler"),
  history: build("historyInteractionHandler"),
  status: build("statusInteractionHandler"),
  latest: build("latestInteractionHandler"),
  outbox: build("outboxAdminHandler"),
  set: build("setInteractionHandler"),
  setRole: build("rolePingHandlers"),
  setGames: build("gameFilterHandlers"),
  subscription: build("subscriptionNotificationHandlers"),
  help: build("helpInteractionHandler"),
  simple: build("simpleCommandsHandler")
};

function chatInput(commandName: string, group: string | null = null, subcommand = "x"): unknown {
  return {
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    guild: { id: "guild-1" },
    commandName,
    options: {
      getSubcommandGroup: (_required?: boolean) => group,
      getSubcommand: () => subcommand
    }
  };
}

function autocompleteInteraction(commandName: string): unknown {
  return {
    isChatInputCommand: () => false,
    isAutocomplete: () => true,
    guild: { id: "guild-1" },
    commandName,
    options: { getSubcommandGroup: () => null, getSubcommand: () => "x" }
  };
}

function soleClaimant(interaction: unknown): string[] {
  return Object.entries(handlers)
    .filter(([, handler]) => handler.canHandle(interaction) === true)
    .map(([key]) => key);
}

function definedTopLevelCommands(): string[] {
  const target: Record<string, unknown> = {
    SlashCommandBuilder,
    PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined,
    env: {}
  };
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as (t: Record<string, unknown>) => void;
  attachSlashCommands(target);
  const defs = (target.buildSlashCommandDefinitions as () => Array<{ name: string }>)();
  return defs.map(def => def.name);
}

const expectedOwnerByCommand: Record<string, string> = {
  ping: "simple",
  games: "simple",
  help: "help",
  config: "config",
  "reset-config": "guildConfigAdmin",
  "admin-alerts": "guildConfigAdmin",
  "price-alert": "priceAlert",
  backup: "backup",
  "bot-log": "auditLog",
  "server-log": "auditLog",
  "price-check": "priceCheck",
  "deal-score": "dealScore",
  "suggest-command": "suggestCommand",
  "watchlist-game": "watchlistGame",
  "future-release": "futureRelease",
  maintenance: "maintenance",
  youtube: "youtube",
  snooze: "snooze",
  unsnooze: "snooze",
  start: "subscription",
  stop: "subscription",
  set: "set",
  watchlist: "setGames",
  latest: "latest",
  dlc: "dlc",
  status: "status",
  sources: "sources",
  history: "history",
  report: "report",
  health: "health",
  outbox: "outbox"
};

test("routing: fiecare slash command top-level e revendicat de exact un handler (din slash definitions)", () => {
  const commands = definedTopLevelCommands();
  assert.ok(commands.length > 0, "buildSlashCommandDefinitions intoarce comenzi");

  for (const command of commands) {
    const expectedOwner = expectedOwnerByCommand[command];
    assert.ok(expectedOwner, `comanda /${command} are un handler asteptat in tabel (familie noua = adauga maparea + buildCommandHandler)`);

    const subcommand = command === "sources" ? "status" : "x";
    const claimants = soleClaimant(chatInput(command, null, subcommand));
    assert.deepEqual(claimants, [expectedOwner], `/${command} e rutat exact catre handler-ul ${expectedOwner}, nimic altceva nu il revendica`);
  }
});

test("routing: subcomenzile /set sunt rutate catre handler-e distincte si mutual-exclusive", () => {
  assert.deepEqual(soleClaimant(chatInput("set", null)), ["set"], "/set fara grup -> setInteractionHandler");
  assert.deepEqual(soleClaimant(chatInput("set", "games")), ["setGames"], "/set games -> gameFilterHandlers");
  assert.deepEqual(soleClaimant(chatInput("set", "role")), ["setRole"], "/set role -> rolePingHandlers");
});

test("routing: interactiunile de autocomplete sunt rutate catre autocompleteHandler, nu catre handler-ele de comenzi", () => {
  assert.deepEqual(soleClaimant(autocompleteInteraction("latest")), ["autocomplete"], "autocomplete (orice comanda) -> autocompleteInteractionHandler");
});

test("routing: un handler de comanda nu revendica comanda altui handler", () => {
  assert.equal(handlers.latest.canHandle(chatInput("dlc")), false, "handler-ul /latest nu revendica /dlc");
  assert.equal(handlers.dlc.canHandle(chatInput("status")), false, "handler-ul /dlc nu revendica /status");
  assert.equal(handlers.status.canHandle(chatInput("latest")), false, "handler-ul /status nu revendica /latest");
  assert.equal(handlers.set.canHandle(chatInput("set", "games")), false, "handler-ul /set direct nu revendica /set games");
  assert.equal(handlers.health.canHandle(autocompleteInteraction("health")), false, "un handler de comanda nu revendica autocomplete");
});

test("routing: toate familiile de comenzi din tabel au un handler care le revendica", () => {
  for (const [command, owner] of Object.entries(expectedOwnerByCommand)) {
    const group = command === "set" ? null : null;
    const subcommand = command === "sources" ? "status" : "x";
    assert.equal(handlers[owner].canHandle(chatInput(command, group, subcommand)), true, `${owner} revendica /${command}`);
  }
});
