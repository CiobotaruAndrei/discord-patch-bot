import test from "node:test";
import assert from "node:assert/strict";
import templateHandler from "../../features/command-handlers/templateAndNotificationPreviewHandler.js";

function interaction(commandName: string, subcommand: string, values: Record<string, string>) {
  return {
    commandName,
    guild: { id: "guild-1" },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => values[name] ?? null
    }
  };
}

test("template set respinge placeholderul necunoscut fara scriere", async () => {
  const edits: unknown[] = [];
  const writes: unknown[] = [];
  const suite = templateHandler.createTemplatePreviewHandler({
    logger: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { edits.push(payload); return payload; },
    getGuildSettings: async () => ({ _id: "guild-1" }),
    GuildModel: { updateOne: async (...args: unknown[]) => { writes.push(args); return {}; } },
    MessageFlags: { Ephemeral: 64 }
  });
  await suite.handle(interaction("template", "set", { command: "/start updates", text: "Salut {game}" }));
  assert.equal(writes.length, 0);
  assert.match(String(edits[0]), /game/);
});

test("notification preview foloseste template-ul activ fara scriere sau side effects", async () => {
  const edits: unknown[] = [];
  let writes = 0;
  const suite = templateHandler.createTemplatePreviewHandler({
    logger: () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { edits.push(payload); return payload; },
    getGuildSettings: async () => ({ _id: "guild-1", notificationChannelId: "channel-1", updateMessageTemplate: "Sunt {count} update-uri" }),
    GuildModel: { updateOne: async () => { writes++; return {}; } },
    MessageFlags: { Ephemeral: 64 }
  });
  await suite.handle(interaction("notification", "preview", { command: "/start updates" }));
  const payload = edits[0] as { content?: string; embeds?: unknown[] };
  assert.match(String(payload.content), /2 update-uri/);
  assert.equal(payload.embeds?.length, 1);
  assert.equal(writes, 0);
});
