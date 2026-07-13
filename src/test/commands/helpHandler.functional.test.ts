import test from "node:test";
import assert from "node:assert/strict";
import { installCommandChain, type ChainableCommandModule } from "../commandChainTestKit.js";
import helpHandler from "../../features/command-handlers/helpInteractionHandler.js";

type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: unknown[]) => Promise<unknown>;
};

function makeHelpInteraction(commandValue?: string | null) {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName: "help",
      guild: { id: "guild-1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      options: { getString: (name: string) => name === "command" ? commandValue ?? null : null },
      reply: async (payload: unknown) => { replies.push(payload); return payload; },
      followUp: async (payload: unknown) => { replies.push(payload); return payload; }
    },
    replies
  };
}

test("help handler replies with the injected help embed", async () => {
  const { interaction, replies } = makeHelpInteraction();
  const embed = { title: "Help" };
  const handlers = helpHandler.createHelpHandler({ buildHelpEmbed: () => embed });
  await handlers.handleHelpInteraction(interaction);
  assert.deepEqual(replies, [{ embeds: [embed] }]);
});

test("help handler replies ephemeral with command-specific details", async () => {
  const { interaction, replies } = makeHelpInteraction("/set add games");
  const handlers = helpHandler.createHelpHandler({
    buildHelpEmbed: () => ({ title: "Help" }),
    MessageFlags: { Ephemeral: 64 }
  });
  await handlers.handleHelpInteraction(interaction);
  const payload = replies[0] as { content: string; flags: number };
  assert.equal(payload.flags, 64);
  assert.match(payload.content, /\/set add games/);
  assert.match(payload.content, /Permisiuni: Admin/);
  assert.match(payload.content, /joc:cs2/);
});

test("help handler reports unknown command values as ephemeral errors", async () => {
  const { interaction, replies } = makeHelpInteraction("/nu-exista");
  const handlers = helpHandler.createHelpHandler({
    buildHelpEmbed: () => ({ title: "Help" }),
    MessageFlags: { Ephemeral: 64 }
  });
  await handlers.handleHelpInteraction(interaction);
  const payload = replies[0] as { content: string; flags: number };
  assert.equal(payload.flags, 64);
  assert.match(payload.content, /Nu am gasit comanda/);
});

test("help handler installer intercepts only /help", async () => {
  const { interaction, replies } = makeHelpInteraction();
  const delegated: string[] = [];
  const context = {
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    buildHelpEmbed: () => ({ title: "Help" }),
    handleInteraction: async (handledInteraction: { commandName: string }) => {
      delegated.push(handledInteraction.commandName);
      return "delegated";
    }
  };
  installCommandChain(context, [helpHandler] as object as ChainableCommandModule[]);
  const runtime = context as typeof context & InteractionRuntime;
  await runtime.handleInteraction(interaction, []);
  const result = await runtime.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    reply: async () => undefined
  }, []);
  assert.deepEqual(replies, [{ embeds: [{ title: "Help" }] }]);
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});

class CapturingEmbedBuilder {
  fields: Array<{ name: string; value: string }> = [];
  setColor() { return this; }
  setTitle() { return this; }
  setDescription() { return this; }
  addFields(...fields: Array<{ name: string; value: string }>) {
    this.fields.push(...fields);
    return this;
  }
}

test("help handler real listeaza suita noua si nu mai afiseaza comenzile eliminate", async () => {
  const { interaction, replies } = makeHelpInteraction();
  const context = {
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    EmbedBuilder: CapturingEmbedBuilder,
    COLORS: { DARK: 0 }
  };
  installCommandChain(context, [helpHandler] as object as ChainableCommandModule[]);
  const runtime = context as typeof context & InteractionRuntime;
  await runtime.handleInteraction(interaction, []);
  const payload = replies[0] as { embeds: CapturingEmbedBuilder[] };
  const text = payload.embeds[0].fields.map(field => `${field.name}\n${field.value}`).join("\n");
  assert.match(text, /\/game overview/);
  assert.match(text, /\/template set/);
  assert.match(text, /\/report complaint/);
  assert.doesNotMatch(text, /\/outbox/);
  assert.doesNotMatch(text, /\/history/);
});
