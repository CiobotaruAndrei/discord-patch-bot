import test from "node:test";
import assert from "node:assert/strict";

import { matchesCommand, type CommandDescriptor } from "../../features/command-registry/commandMatch.js";

function makeInteraction(opts: {
  commandName?: string;
  chatInput?: boolean;
  guild?: unknown;
  group?: string | null;
  subcommand?: string | null;
  subcommandThrows?: boolean;
}) {
  return {
    commandName: opts.commandName,
    guild: "guild" in opts ? opts.guild : { id: "g1" },
    isChatInputCommand: () => opts.chatInput ?? true,
    options: {
      getSubcommandGroup: () => opts.group ?? null,
      getSubcommand: () => {
        if (opts.subcommandThrows) throw new Error("no subcommand");
        return opts.subcommand ?? null;
      }
    }
  };
}

test("matchesCommand: nu e chat input command -> false", () => {
  assert.equal(matchesCommand(makeInteraction({ commandName: "config", chatInput: false }), { commandNames: ["config"] }), false);
});

test("matchesCommand: valoare non-obiect -> false", () => {
  assert.equal(matchesCommand(null, { commandNames: ["config"] }), false);
  assert.equal(matchesCommand("config", { commandNames: ["config"] }), false);
});

test("matchesCommand: requireGuild implicit true respinge fara guild", () => {
  assert.equal(matchesCommand(makeInteraction({ commandName: "config", guild: null }), { commandNames: ["config"] }), false);
  assert.equal(matchesCommand(makeInteraction({ commandName: "config" }), { commandNames: ["config"] }), true);
});

test("matchesCommand: requireGuild false accepta fara guild", () => {
  const desc: CommandDescriptor = { commandNames: ["health"], requireGuild: false };
  assert.equal(matchesCommand(makeInteraction({ commandName: "health", guild: null }), desc), true);
});

test("matchesCommand: nume de comanda simplu si multiplu", () => {
  assert.equal(matchesCommand(makeInteraction({ commandName: "config" }), { commandNames: ["config"] }), true);
  assert.equal(matchesCommand(makeInteraction({ commandName: "other" }), { commandNames: ["config"] }), false);
  const multi: CommandDescriptor = { commandNames: ["bot-log", "server-log"] };
  assert.equal(matchesCommand(makeInteraction({ commandName: "bot-log" }), multi), true);
  assert.equal(matchesCommand(makeInteraction({ commandName: "server-log" }), multi), true);
  assert.equal(matchesCommand(makeInteraction({ commandName: "audit" }), multi), false);
});

test("matchesCommand: filtreaza pe grup cand descriptorul cere grup", () => {
  const desc: CommandDescriptor = { commandNames: ["set"], group: "role" };
  assert.equal(matchesCommand(makeInteraction({ commandName: "set", group: "role" }), desc), true);
  assert.equal(matchesCommand(makeInteraction({ commandName: "set", group: "games" }), desc), false);
  assert.equal(matchesCommand(makeInteraction({ commandName: "set", group: null }), desc), false);
});

test("matchesCommand: filtreaza pe subcomanda si trateaza throw-ul ca fara subcomanda", () => {
  const desc: CommandDescriptor = { commandNames: ["sources"], subcommand: "status" };
  assert.equal(matchesCommand(makeInteraction({ commandName: "sources", subcommand: "status" }), desc), true);
  assert.equal(matchesCommand(makeInteraction({ commandName: "sources", subcommand: "refresh" }), desc), false);
  assert.equal(matchesCommand(makeInteraction({ commandName: "sources", subcommandThrows: true }), desc), false);
});

test("matchesCommand: commandName lipsa -> false", () => {
  assert.equal(matchesCommand(makeInteraction({}), { commandNames: ["config"] }), false);
});

test("matchesCommand: interactiune fara options -> group/subcommand cerute nu se potrivesc", () => {
  const bare = {
    commandName: "sources",
    guild: { id: "g1" },
    isChatInputCommand: () => true
  };
  assert.equal(matchesCommand(bare, { commandNames: ["sources"], subcommand: "status" }), false);
  assert.equal(matchesCommand(bare, { commandNames: ["sources"], group: "x" }), false);
  assert.equal(matchesCommand(bare, { commandNames: ["sources"] }), true);
});

test("matchesCommand: grup si subcomanda combinate trebuie sa se potriveasca amandoua", () => {
  const desc: CommandDescriptor = { commandNames: ["set"], group: "add", subcommand: "games" };
  assert.equal(matchesCommand(makeInteraction({ commandName: "set", group: "add", subcommand: "games" }), desc), true);
  assert.equal(matchesCommand(makeInteraction({ commandName: "set", group: "add", subcommand: "role" }), desc), false);
  assert.equal(matchesCommand(makeInteraction({ commandName: "set", group: "remove", subcommand: "games" }), desc), false);
});
