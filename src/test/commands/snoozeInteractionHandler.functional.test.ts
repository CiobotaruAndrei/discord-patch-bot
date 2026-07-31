import test from "node:test";
import snoozeInteractions from "../../features/command-handlers/snoozeInteractionHandler.js";
import assert from "node:assert/strict";

type UpdateCall = {
  filter: unknown;
  update: unknown;
  options?: unknown;
};

type SnoozeRuntime = {
  handleSnoozeInteraction: (interaction: unknown) => Promise<unknown>;
};

function makeContext() {
  const calls: UpdateCall[] = [];
  const replies: unknown[] = [];
  const edits: unknown[] = [];
  const runtime = snoozeInteractions.createSnoozeInteractionHandler({
    MessageFlags: { Ephemeral: 64 },
    GuildModel: {
      updateOne: async (filter: unknown, update: unknown, options?: unknown) => {
        calls.push({ filter, update, options });
        return { matchedCount: 1, modifiedCount: 1 };
      }
    },
    safeDefer: async (interaction: { deferred?: boolean }) => { interaction.deferred = true; },
    safeEdit: async (_interaction: unknown, payload: unknown) => {
      edits.push(payload);
      return payload;
    }
  });
  return { runtime, calls, replies, edits };
}

function makeInteraction(commandName: string, command: string, durata = "2h") {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName,
      guild: { id: "guild-1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      options: {
        getString: (name: string) => {
          if (name === "command") return command;
          if (name === "durata") return durata;
          return null;
        }
      },
      reply: async (payload: unknown) => {
        replies.push(payload);
        return payload;
      }
    },
    replies
  };
}

test("/snooze salveaza comanda si durata in commandSnoozes", async () => {
  const { runtime, calls, edits } = makeContext();
  const { interaction, replies } = makeInteraction("snooze", "/latest updates", "2h");

  await runtime.handleSnoozeInteraction(interaction);

  assert.equal(replies.length, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(calls[0].options, { upsert: true });
  const update = calls[0].update as { $set: Record<string, Date> };
  assert.ok(update.$set["commandSnoozes.latest__updates"] instanceof Date);
  assert.match(String(edits[0]), /\/latest updates.*pauza/);
});

test("/unsnooze sterge pauza pentru comanda aleasa", async () => {
  const { runtime, calls, edits } = makeContext();
  const { interaction } = makeInteraction("unsnooze", "/latest updates");

  await runtime.handleSnoozeInteraction(interaction);

  assert.deepEqual(calls[0].filter, { _id: "guild-1" });
  assert.deepEqual(calls[0].update, { $unset: { "commandSnoozes.latest__updates": "" } });
  assert.match(String(edits[0]), /nu mai este in pauza/);
});

test("/snooze respinge comenzi inexistente sau comenzi de control", async () => {
  const { runtime, calls } = makeContext();
  const missing = makeInteraction("snooze", "/nu-exista");
  const control = makeInteraction("snooze", "/unsnooze");

  await runtime.handleSnoozeInteraction(missing.interaction);
  await runtime.handleSnoozeInteraction(control.interaction);

  assert.equal(calls.length, 0);
  assert.match(String((missing.replies[0] as { content?: string }).content), /comanda existenta/);
  assert.match(String((control.replies[0] as { content?: string }).content), /nu poti pune pe pauza/);
});
