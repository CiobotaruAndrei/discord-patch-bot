import test from "node:test";
import assert from "node:assert/strict";

type HelpModule = ((context: Record<string, unknown>) => void) & {
  createHelpHandler: (deps: Record<string, unknown>) => {
    handleHelpInteraction: (interaction: Record<string, unknown>) => Promise<unknown>;
  };
};
type InteractionRuntime = {
  handleInteraction: (interaction: unknown, games?: unknown[]) => Promise<unknown>;
};

const helpHandler = require("../features/command-handlers/helpInteractionHandler") as HelpModule;

function makeHelpInteraction() {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName: "help",
      guild: { id: "guild-1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
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

  helpHandler(context);
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

test("help handler real (din EmbedBuilder + COLORS) listeaza toate subcomenzile /outbox", async () => {
  const { interaction, replies } = makeHelpInteraction();
  const context = {
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    EmbedBuilder: CapturingEmbedBuilder,
    COLORS: { DARK: 0 }
  };

  helpHandler(context);
  const runtime = context as typeof context & InteractionRuntime;
  await runtime.handleInteraction(interaction, []);

  const payload = replies[0] as { embeds: CapturingEmbedBuilder[] };
  const embed = payload.embeds[0];
  const outboxField = embed.fields.find(field => field.name.toLowerCase().includes("outbox"));
  assert.ok(outboxField, "embed-ul real de help are sectiunea de operare outbox");

  const expectedSubcommands = [
    "status",
    "deadletters",
    "clear-deadletters",
    "replay-deadletters",
    "retry",
    "drain-now",
    "pause",
    "resume",
    "permissions",
    "recovery-verify status"
  ];
  for (const sub of expectedSubcommands) {
    assert.ok(
      outboxField!.value.includes(`/outbox ${sub}`),
      `/help listeaza /outbox ${sub} (regresie: comanda definita dar absenta din embed-ul real)`
    );
  }
});
