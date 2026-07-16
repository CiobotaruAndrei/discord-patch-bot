import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI ||= "mongodb://localhost:27017/discord-patch-bot-test";
process.env.DISCORD_TOKEN ||= "test_discord_token";
process.env.DISCORD_CLIENT_ID ||= "test_discord_client_id";
process.env.METRICS_PUBLIC ||= "true";

const { enumerateCommandProbes, buildOwnershipProbeInteraction, assertExclusiveCommandOwnership } = await import("../../features/command-registry/commandOwnership.js");
const { createCommandHandlerDescriptors } = await import("../../features/command-registry/commandHandlerDescriptors.js");
const commandRegistry = (await import("../../features/command-registry/commandRegistry.js")).default;

test("enumerateCommandProbes acopera comenzi simple, subcomenzi si grupuri de subcomenzi", () => {
  const probes = enumerateCommandProbes([
    { name: "ping" },
    { name: "watchlist", options: [{ type: 1, name: "coverage" }, { type: 1, name: "show" }] },
    { name: "set", options: [{ type: 1, name: "mode" }, { type: 2, name: "add", options: [{ type: 1, name: "games" }] }] }
  ]);
  assert.deepEqual(probes, [
    { commandName: "ping", group: null, subcommand: null },
    { commandName: "watchlist", group: null, subcommand: "coverage" },
    { commandName: "watchlist", group: null, subcommand: "show" },
    { commandName: "set", group: null, subcommand: "mode" },
    { commandName: "set", group: "add", subcommand: "games" }
  ]);
});

test("assertExclusiveCommandOwnership arunca si numeste ambele handlere cand doua revendica aceeasi comanda", () => {
  const definitions = [{ name: "set", options: [{ type: 2, name: "add", options: [{ type: 1, name: "games" }] }] }];
  const claimsSetAddGames = (interaction: unknown) => {
    const probe = interaction as { commandName?: string; options?: { getSubcommandGroup(): string | null; getSubcommand(): string | null } };
    return probe.commandName === "set" && probe.options?.getSubcommandGroup() === "add" && probe.options?.getSubcommand() === "games";
  };
  assert.throws(
    () => assertExclusiveCommandOwnership(definitions, [
      { id: "primul", domain: "configuration", canHandle: claimsSetAddGames },
      { id: "al-doilea", domain: "configuration", canHandle: claimsSetAddGames }
    ]),
    /set add games.*primul, al-doilea/
  );
});

test("assertExclusiveCommandOwnership arunca pentru o comanda orfana (nerevendicata de niciun handler dedicat)", () => {
  assert.throws(
    () => assertExclusiveCommandOwnership([{ name: "ping" }], [
      { id: "altul", domain: "core", canHandle: () => false }
    ]),
    /ping.*niciun handler/
  );
});

test("assertExclusiveCommandOwnership ignora handler-ele de routing (fallback-ul care revendica orice nu e o coliziune)", () => {
  assert.doesNotThrow(() => assertExclusiveCommandOwnership([{ name: "ping" }], [
    { id: "simple", domain: "core", canHandle: interaction => (interaction as { commandName?: string }).commandName === "ping" },
    { id: "fallback", domain: "routing", canHandle: () => true }
  ]));
});

test("registrul REAL: fiecare comanda din slash definitions e revendicata de exact un handler ne-routing (review nou, Mediu #10)", () => {
  assert.doesNotThrow(() => commandRegistry.createCommandRegistry({ getGuildSettings: async () => null }));
});

test("regresie umbrire: /set add games si /set remove games apartin lui game-filter, nu handler-ului generic /set", () => {
  const ctx = commandRegistry.createAppServices({ getGuildSettings: async () => null });
  const descriptors = createCommandHandlerDescriptors();
  const setDescriptor = descriptors.find(descriptor => descriptor.id === "set");
  const gameFilterDescriptor = descriptors.find(descriptor => descriptor.id === "game-filter");
  assert.ok(setDescriptor && gameFilterDescriptor, "descriptorii set si game-filter exista in registru");
  const setHandler = setDescriptor.build(ctx);
  const gameFilterHandler = gameFilterDescriptor.build(ctx);
  for (const operation of ["add", "remove"]) {
    const probe = buildOwnershipProbeInteraction({ commandName: "set", group: operation, subcommand: "games" });
    assert.equal(gameFilterHandler.canHandle(probe), true, `game-filter revendica /set ${operation} games (implementarea dedicata)`);
    assert.equal(setHandler.canHandle(probe), false, `handler-ul generic /set NU mai umbreste /set ${operation} games (inainte raspundea el, cu "subcomanda necunoscuta")`);
  }
  const modeProbe = buildOwnershipProbeInteraction({ commandName: "set", group: null, subcommand: "mode" });
  assert.equal(setHandler.canHandle(modeProbe), true, "handler-ul /set isi pastreaza subcomenzile proprii");
  assert.equal(gameFilterHandler.canHandle(modeProbe), false);
});
