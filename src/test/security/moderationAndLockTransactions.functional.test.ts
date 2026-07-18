import test from "node:test";
import assert from "node:assert/strict";
import moderationModule from "../../features/command-handlers/moderationInteractionHandler.js";
import securityModule from "../../features/command-handlers/securityInteractionHandler.js";
import type { WarningRecord } from "../../features/moderation/moderationRepository.js";

type ModerationState = { moderationWarnings: WarningRecord[]; moderationWarnBanLimit: number };

function makeModerationHarness(sendFailure = false, rollbackFailure = false, initialWarnings: WarningRecord[] = []) {
  const state: ModerationState = { moderationWarnings: initialWarnings, moderationWarnBanLimit: 0 };
  const writes: Record<string, unknown>[] = [];
  const guildModel = {
    findOne: () => ({ lean: async () => state }),
    updateOne: async (_filter: { _id: string }, update: Record<string, unknown>) => {
      writes.push(update);
      if (rollbackFailure && writes.length > 1) throw new Error("rollback failed");
      const set = update.$set as Record<string, unknown> | undefined;
      if (set?.moderationWarnings) state.moderationWarnings = set.moderationWarnings as WarningRecord[];
      return { acknowledged: true };
    }
  };
  const target = { id: "target", user: { id: "target", username: "Target" }, roles: { highest: { position: 1 } } };
  const channel = {
    send(payload: unknown) {
      assert.equal(this, channel);
      if (sendFailure) throw new Error("send failed");
      return Promise.resolve(payload);
    }
  };
  const replies: unknown[] = [];
  const interaction = {
    commandName: "warn",
    guild: { id: "guild", ownerId: "owner", members: { me: { id: "bot", roles: { highest: { position: 10 } }, permissions: { has: () => true } }, fetch: async () => target } },
    user: { id: "moderator", username: "Moderator" },
    member: { id: "moderator", roles: { highest: { position: 5 } } },
    channel,
    isChatInputCommand: () => true,
    options: {
      getUser: () => ({ id: "target", username: "Target" }),
      getString: (name: string) => name === "motiv" || name === "reason" ? "regula incalcata" : null,
      getInteger: () => null
    },
    reply: async (payload: unknown) => { replies.push(payload); }
  };
  const moderationHandler = moderationModule.createModerationInteractionHandler({
    GuildModel: guildModel,
    MessageFlags: { Ephemeral: 64 },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); },
    logger: () => undefined
  });
  return { state, writes, interaction, replies, moderationHandler };
}

test("warn apeleaza channel.send cu receiverul corect si confirma doar dupa publicare", async () => {
  const harness = makeModerationHarness();
  await harness.moderationHandler.handle(harness.interaction);
  assert.equal(harness.state.moderationWarnings.length, 1);
  assert.match(String(harness.replies.at(-1)), /a primit warn-ul/);
  assert.equal(harness.writes.length, 1);
});

test("warn compenseaza persistenta cand publicarea esueaza", async () => {
  const harness = makeModerationHarness(true);
  await harness.moderationHandler.handle(harness.interaction);
  assert.equal(harness.state.moderationWarnings.length, 0);
  assert.match(String(harness.replies.at(-1)), /nu a fost pastrat/);
  assert.equal(harness.writes.length, 2);
});

test("warn pastreaza avertismentele anterioare cand rollback-ul celui nou reuseste", async () => {
  const previous: WarningRecord = { userId: "target", username: "Target", moderatorId: "old", warnedAt: new Date(1), reason: "anterior" };
  const harness = makeModerationHarness(true, false, [previous]);
  await harness.moderationHandler.handle(harness.interaction);
  assert.deepEqual(harness.state.moderationWarnings, [previous]);
});

test("warn raporteaza explicit esecul rollback-ului", async () => {
  const logs: string[] = [];
  const harness = makeModerationHarness(true, true);
  harness.moderationHandler = moderationModule.createModerationInteractionHandler({
    GuildModel: {
      findOne: () => ({ lean: async () => harness.state }),
      updateOne: async (_filter, update) => {
        harness.writes.push(update);
        if (harness.writes.length > 1) throw new Error("rollback failed");
        const set = update.$set as Record<string, unknown>;
        harness.state.moderationWarnings = set.moderationWarnings as WarningRecord[];
        return { acknowledged: true };
      }
    },
    MessageFlags: { Ephemeral: 64 },
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { harness.replies.push(payload); },
    logger: (_level, _context, message) => { logs.push(message); }
  });
  await harness.moderationHandler.handle(harness.interaction);
  assert.match(String(harness.replies.at(-1)), /rollback-ul a esuat/);
  assert.ok(logs.some(message => /Rollback/.test(message)));
});

type LockState = { lockedChannelIds: string[]; lockedChannelPreviousSendMessages: Record<string, boolean> };

function replyContent(replies: unknown[]): string {
  const value = replies.at(-1);
  return typeof value === "string" ? value : value && typeof value === "object" && "content" in value && typeof value.content === "string" ? value.content : "";
}

function makeLockHarness(command: "lock-channel" | "unlock-channel", sendFailure = false, persistFailure = false) {
  const state: LockState = { lockedChannelIds: command === "unlock-channel" ? ["channel"] : [], lockedChannelPreviousSendMessages: command === "unlock-channel" ? { channel: true } : {} };
  let sendMessagesState: boolean | null = command === "unlock-channel" ? false : null;
  const edits: Array<boolean | null> = [];
  const repositoryWrites: Array<{ locked: boolean; previous?: boolean | null }> = [];
  const everyone = { id: "everyone" };
  const permissionOverwrites = {
    edit(target: unknown, permissions: Record<string, boolean | null>) {
      assert.equal(this, permissionOverwrites);
      assert.equal(target, everyone);
      const next = permissions.SendMessages;
      edits.push(next);
      sendMessagesState = next;
      return Promise.resolve();
    }
  };
  const channel = {
    id: "channel",
    sendMessagesState,
    permissionOverwrites,
    send(payload: unknown) {
      assert.equal(this, channel);
      if (sendFailure) throw new Error("send failed");
      return Promise.resolve(payload);
    }
  };
  const replies: unknown[] = [];
  const interaction = {
    commandName: command,
    guild: { id: "guild", roles: { everyone } },
    channel,
    user: { id: "moderator" },
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => "",
      getString: (name: string) => name === "motiv" || name === "reason" ? "mentenanta" : null,
      getInteger: () => null,
      getChannel: () => channel
    }
  };
  const repository = {
    setField: async () => undefined,
    setFieldIfVersion: async () => undefined,
    updateChannelLock: async (_guildId: string, _channelId: string, locked: boolean, previous?: boolean | null) => {
      repositoryWrites.push({ locked, previous });
      if (persistFailure && locked) throw new Error("persist failed");
      if (locked) state.lockedChannelIds = ["channel"];
      else state.lockedChannelIds = [];
    },
    setGameAliases: async () => undefined
  };
  const handler = securityModule.buildCommandHandler({
    GuildModel: { updateOne: async () => ({}) },
    guildSettingsRepository: repository,
    getGuildSettings: async () => state,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction, payload) => { replies.push(payload); },
    formatUserError: (_error, fallback) => fallback,
    checkChannelPermissions: async () => ({ viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true, manageChannels: true }),
    logger: () => undefined
  });
  return { state, edits, repositoryWrites, replies, interaction, handler };
}

test("lock-channel persista, revalideaza si trimite mesajul cu receiverul corect", async () => {
  const harness = makeLockHarness("lock-channel");
  await harness.handler.handle(harness.interaction, []);
  assert.deepEqual(harness.edits, [false]);
  assert.equal(harness.repositoryWrites[0].locked, true);
  assert.match(replyContent(harness.replies), /a fost blocat/);
});

test("lock-channel face rollback cand mesajul obligatoriu esueaza", async () => {
  const harness = makeLockHarness("lock-channel", true);
  await harness.handler.handle(harness.interaction, []);
  assert.deepEqual(harness.edits, [false, null]);
  assert.deepEqual(harness.repositoryWrites.map(write => write.locked), [true, false]);
  assert.match(replyContent(harness.replies), /lock-ul a fost anulat/);
});

test("lock-channel face rollback cand persistenta esueaza", async () => {
  const harness = makeLockHarness("lock-channel", false, true);
  await harness.handler.handle(harness.interaction, []);
  assert.deepEqual(harness.edits, [false, null]);
  assert.deepEqual(harness.repositoryWrites.map(write => write.locked), [true, false]);
});

test("unlock-channel restaureaza overwrite-ul salvat", async () => {
  const harness = makeLockHarness("unlock-channel");
  await harness.handler.handle(harness.interaction, []);
  assert.deepEqual(harness.edits, [true]);
  assert.equal(harness.repositoryWrites[0].locked, false);
  assert.match(replyContent(harness.replies), /starea anterioara a fost restaurata/);
});
