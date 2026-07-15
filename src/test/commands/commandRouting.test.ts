import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

type CanHandle = (interaction: unknown) => boolean;
type BuiltHandler = { canHandle: CanHandle };
type HandlerModule = { buildCommandHandler: (ctx: unknown) => BuiltHandler };

const deepStub: unknown = new Proxy({}, { get: () => deepStub });
const stubContext = deepStub;

function build(moduleName: string): BuiltHandler {
  const mod = (require(`../../features/command-handlers/${moduleName}`) as { default: HandlerModule }).default;
  return mod.buildCommandHandler(stubContext);
}

const handlers: Record<string, BuiltHandler> = {
  autocomplete: build("autocompleteInteractionHandler"),
  dlc: build("dlcInteractionHandler"),
  sources: build("sourcesStatusHandler"),
  config: build("configInteractionHandler"),
  guildConfigAdmin: build("guildConfigurationAdminHandler"),
  adminCommandAccess: build("adminCommandAccessHandler"),
  priceAlert: build("priceAlertInteractionHandler"),
  backup: build("backupInteractionHandler"),
  auditLog: build("auditLogInteractionHandler"),
  suggestCommand: build("suggestCommandInteractionHandler"),
  watchlistGame: build("watchlistGameSuggestionHandler"),
  futureRelease: build("futureReleaseInteractionHandler"),
  dealScore: build("dealScoreInteractionHandler"),
  gameOverview: build("gameOverviewInteractionHandler"),
  playerAnalytics: build("playerCountAnalyticsHandler"),
  coverageAlias: build("watchlistCoverageAndAliasHandler"),
  templatePreview: build("templateAndNotificationPreviewHandler"),
  gameInfo: build("gameInfoInteractionHandler"),
  maintenance: build("maintenanceInteractionHandler"),
  priceCheck: build("priceCheckInteractionHandler"),
  youtube: build("youtubeInteractionHandler"),
  snooze: build("snoozeInteractionHandler"),
  health: build("healthInteractionHandler"),
  report: build("reportInteractionHandler"),
  status: build("statusInteractionHandler"),
  latest: build("latestInteractionHandler"),
  set: build("setInteractionHandler"),
  setRole: build("rolePingHandlers"),
  setGames: build("gameFilterHandlers"),
  subscription: build("subscriptionNotificationHandlers"),
  security: build("securityInteractionHandler"),
  moderation: build("moderationInteractionHandler"),
  "bot-add": build("botAddInteractionHandler"),
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
  const attachSlashCommands = require("../../features/command-definitions/slashCommandDefinitions").default as (t: Record<string, unknown>) => void;
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
  "admin-command-access": "adminCommandAccess",
  delete: "adminCommandAccess",
  "price-alert": "priceAlert",
  backup: "backup",
  "bot-log": "auditLog",
  "server-log": "auditLog",
  "price-check": "priceCheck",
  "deal-score": "dealScore",
  "suggest-command": "suggestCommand",
  "watchlist-game": "watchlistGame",
  "future-release": "futureRelease",
  best: "gameInfo",
  ending: "gameInfo",
  "review-trend": "gameInfo",
  crossplay: "gameInfo",
  platforms: "gameInfo",
  "co-op": "gameInfo",
  system: "gameInfo",
  "game-size": "gameInfo",
  "player-count": "playerAnalytics",
  game: "gameOverview",
  top: "gameInfo",
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
  report: "report",
  health: "health",
  template: "templatePreview",
  notification: "templatePreview",
  "game-alias": "coverageAlias"
  ,"lock-channel": "security"
  ,"unlock-channel": "security"
  ,"purge": "security"
  ,"purge-amount": "security"
  ,"timeout": "moderation"
  ,"remove-timeout": "moderation"
  ,"timeout-list": "moderation"
  ,"mute": "moderation"
  ,"unmute": "moderation"
  ,"mute-list": "moderation"
  ,"kick": "moderation"
  ,"ban": "moderation"
  ,"unban": "moderation"
  ,"warn": "moderation"
  ,"remove-warn": "moderation"
  ,"warn-list": "moderation"
  ,"warn-ban-limit": "moderation"
  ,"bot-add-request": "bot-add"
  ,"bot-add-permissions": "bot-add"
};

const MULTIPLEXED_VERB_COMMANDS = new Set(["add", "remove"]);

test("routing: fiecare slash command top-level e revendicat de exact un handler (din slash definitions)", () => {
  const commands = definedTopLevelCommands();
  assert.ok(commands.length > 0, "buildSlashCommandDefinitions intoarce comenzi");

  for (const command of commands) {
    if (MULTIPLEXED_VERB_COMMANDS.has(command)) continue;
    const expectedOwner = expectedOwnerByCommand[command];
    assert.ok(expectedOwner, `comanda /${command} are un handler asteptat in tabel (familie noua = adauga maparea + buildCommandHandler)`);

    const subcommand = command === "sources" ? "status"
      : command === "delete" ? "admin-command-access"
      : command === "player-count" ? "trend"
      : command === "game" ? "overview"
      : command === "template" ? "set"
      : command === "notification" ? "preview"
      : command === "game-alias" ? "list"
      : "x";
    const claimants = soleClaimant(chatInput(command, null, subcommand));
    assert.deepEqual(claimants, [expectedOwner], `/${command} e rutat exact catre handler-ul ${expectedOwner}, nimic altceva nu il revendica`);
  }
});

test("routing: /add si /remove sunt multiplexate pe subcomanda catre handler-ul resursei", () => {
  const commands = definedTopLevelCommands();
  assert.ok(commands.includes("add") && commands.includes("remove"), "definitiile contin /add si /remove");

  assert.deepEqual(soleClaimant(chatInput("add", null, "price-alert")), ["priceAlert"], "/add price-alert -> priceAlert");
  assert.deepEqual(soleClaimant(chatInput("add", null, "watchlist")), ["setGames"], "/add watchlist -> gameFilterHandlers");
  assert.deepEqual(soleClaimant(chatInput("add", null, "backup")), ["backup"], "/add backup -> backup");
  assert.deepEqual(soleClaimant(chatInput("add", null, "suggestion")), ["suggestCommand"], "/add suggestion -> suggestCommand");
  assert.deepEqual(soleClaimant(chatInput("remove", null, "price-alert")), ["priceAlert"], "/remove price-alert -> priceAlert");
  assert.deepEqual(soleClaimant(chatInput("remove", null, "watchlist")), ["setGames"], "/remove watchlist -> gameFilterHandlers");
});

test("routing: subcomenzile /set sunt rutate catre handler-e distincte si mutual-exclusive", () => {
  assert.deepEqual(soleClaimant(chatInput("set", null)), ["set"], "/set fara grup -> setInteractionHandler");
  assert.deepEqual(soleClaimant(chatInput("set", null, "admin-command-access")), ["adminCommandAccess"], "/set admin-command-access -> adminCommandAccessHandler");
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
    const subcommand = command === "sources" ? "status"
      : command === "delete" ? "admin-command-access"
      : command === "player-count" ? "trend"
      : command === "game" ? "overview"
      : command === "template" ? "set"
      : command === "notification" ? "preview"
      : command === "game-alias" ? "list"
      : "x";
    assert.equal(handlers[owner].canHandle(chatInput(command, group, subcommand)), true, `${owner} revendica /${command}`);
  }
});
