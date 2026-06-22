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
const { SlashCommandBuilder, PermissionsBitField } = require("discord.js");

interface SlashJsonOption { type: number; name: string; options?: SlashJsonOption[] }
interface SlashJsonCommand { name: string; options?: SlashJsonOption[] }

function outboxSubcommandsFromSlashDefinitions(): string[] {
  const target: Record<string, unknown> = {
    SlashCommandBuilder, PermissionsBitField,
    SUPPORTED_CURRENCIES: { USD: {}, EUR: {}, GBP: {}, RON: {} },
    logger: () => undefined, env: {}
  };
  const attachSlashCommands = require("../features/command-definitions/slashCommandDefinitions") as (t: Record<string, unknown>) => void;
  attachSlashCommands(target);
  const defs = (target.buildSlashCommandDefinitions as () => SlashJsonCommand[])();
  const outbox = defs.find(cmd => cmd.name === "outbox");
  const subs: string[] = [];
  for (const opt of outbox?.options || []) {
    if (opt.type === 1) subs.push(opt.name);
    else if (opt.type === 2) {
      for (const sub of opt.options || []) {
        if (sub.type === 1) subs.push(`${opt.name} ${sub.name}`);
      }
    }
  }
  return subs;
}

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

test("help handler real (din EmbedBuilder + COLORS) listeaza toate subcomenzile /outbox derivate din slash definitions", async () => {
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

  const outboxSubcommands = outboxSubcommandsFromSlashDefinitions();
  assert.ok(outboxSubcommands.length >= 8, "slash definitions expun subcomenzile /outbox (sanity al parserului)");
  for (const sub of outboxSubcommands) {
    assert.ok(
      outboxField!.value.includes(`/outbox ${sub}`),
      `/help listeaza /outbox ${sub} (derivat din slash definitions, nu hardcodat — regresie: subcomanda definita dar absenta din embed-ul real)`
    );
  }
});
