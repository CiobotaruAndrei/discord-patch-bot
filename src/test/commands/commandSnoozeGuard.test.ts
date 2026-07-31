import test from "node:test";
import snoozeGuard from "../../features/command-security/commandSnoozeGuard.js";
import assert from "node:assert/strict";

function makeInteraction(commandName: string, subcommand: string | null = null) {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName,
      guild: { id: "guild-1" },
      isChatInputCommand: () => true,
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => subcommand
      },
      reply: async (payload: unknown) => {
        replies.push(payload);
        return payload;
      }
    },
    replies
  };
}

test("command snooze guard blocheaza comanda pana expira pauza", async () => {
  const future = new Date(Date.now() + 60_000);
  const delegated: string[] = [];
  const guard = snoozeGuard.createCommandSnoozeGuard({
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => ({ _id: "guild-1", commandSnoozes: { latest__updates: future } })
  });
  const { interaction, replies } = makeInteraction("latest", "updates");

  const result = await guard.handleSnoozedCommand(interaction, [], async handled => {
    delegated.push((handled as { commandName?: string }).commandName || "");
    return "delegated";
  });

  assert.equal(result, undefined);
  assert.deepEqual(delegated, []);
  assert.match(String((replies[0] as { content?: string }).content), /\/latest updates.*pauza/);
});

test("command snooze guard permite comanda dupa expirare si nu blocheaza /unsnooze", async () => {
  const past = new Date(Date.now() - 60_000);
  const delegated: string[] = [];
  const guard = snoozeGuard.createCommandSnoozeGuard({
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => ({ _id: "guild-1", commandSnoozes: { latest__updates: past, unsnooze: new Date(Date.now() + 60_000) } })
  });
  const expired = makeInteraction("latest", "updates");
  const control = makeInteraction("unsnooze");

  await guard.handleSnoozedCommand(expired.interaction, [], async handled => {
    delegated.push((handled as { commandName?: string }).commandName || "");
    return "expired";
  });
  await guard.handleSnoozedCommand(control.interaction, [], async handled => {
    delegated.push((handled as { commandName?: string }).commandName || "");
    return "control";
  });

  assert.deepEqual(delegated, ["latest", "unsnooze"]);
  assert.deepEqual(expired.replies, []);
  assert.deepEqual(control.replies, []);
});
