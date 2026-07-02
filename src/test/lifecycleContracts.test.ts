import test from "node:test";
import assert from "node:assert/strict";

import type {
  LifecycleDiscordChannel,
  LifecycleDiscordGuild,
  LifecycleDiscordInteraction,
  LifecycleEventClient
} from "../app/lifecycle/lifecycleContracts";
import type { RegisterDiscordEventsDeps } from "../app/lifecycle/events";

type NotUnknown<T> = unknown extends T ? false : true;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type HandleInteractionParam = Parameters<RegisterDiscordEventsDeps["commands"]["handleInteraction"]>[0];
type CanSendEmbedsParam = Parameters<RegisterDiscordEventsDeps["commands"]["canSendEmbeds"]>[0];
type EventsClient = RegisterDiscordEventsDeps["client"];

type ContractChecks = [
  NotUnknown<HandleInteractionParam>,
  NotUnknown<CanSendEmbedsParam>,
  Same<HandleInteractionParam, LifecycleDiscordInteraction>,
  Same<CanSendEmbedsParam, LifecycleDiscordChannel>,
  Same<EventsClient, LifecycleEventClient>
];

const contractChecks: ContractChecks = [true, true, true, true, true];

test("contractele lifecycle nu mai expun unknown pentru interactiune, canal si client", () => {
  assert.equal(contractChecks.length, 5);
  assert.ok(contractChecks.every(check => check === true));
});

test("un client discord.js-like satisface structural LifecycleEventClient, iar listener-ele primesc tipurile dedicate", async () => {
  const listeners = new Map<string, (payload: never) => unknown>();
  const client: LifecycleEventClient = {
    user: { id: "bot-1", tag: "bot#0001" },
    once: (_event, _listener) => undefined,
    on: (event: string, listener: (payload: never) => unknown) => {
      listeners.set(event, listener);
      return undefined;
    }
  };

  const replies: unknown[] = [];
  client.on("interactionCreate", async (interaction: LifecycleDiscordInteraction) => {
    if (typeof interaction.reply === "function") {
      replies.push(await interaction.reply({ content: "pong" }));
    }
  });
  client.on("guildCreate", (guild: LifecycleDiscordGuild) => {
    replies.push(guild.id);
  });

  const interactionListener = listeners.get("interactionCreate") as (interaction: LifecycleDiscordInteraction) => Promise<unknown>;
  await interactionListener({ reply: async payload => payload });
  const guildListener = listeners.get("guildCreate") as (guild: LifecycleDiscordGuild) => unknown;
  guildListener({ id: "guild-1" });

  assert.deepEqual(replies, [{ content: "pong" }, "guild-1"]);
});
