import test from "node:test";
import assert from "node:assert/strict";

type HelpModule = ((ctx: Record<string, any>) => void) & {
  createHelpHandler: (deps: Record<string, any>) => {
    handleHelpInteraction: (interaction: Record<string, any>) => Promise<unknown>;
  };
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
  const ctx: Record<string, any> = {
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    buildHelpEmbed: () => ({ title: "Help" }),
    handleInteraction: async (handledInteraction: Record<string, any>) => {
      delegated.push(handledInteraction.commandName);
      return "delegated";
    }
  };

  helpHandler(ctx);
  await ctx.handleInteraction(interaction, []);
  const result = await ctx.handleInteraction({
    commandName: "latest",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    reply: async () => undefined
  }, []);

  assert.deepEqual(replies, [{ embeds: [{ title: "Help" }] }]);
  assert.deepEqual(delegated, ["latest"]);
  assert.equal(result, "delegated");
});
