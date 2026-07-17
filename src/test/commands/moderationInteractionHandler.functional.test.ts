import test from "node:test";
import assert from "node:assert/strict";

import moderationInteractionHandler from "../../features/command-handlers/moderationInteractionHandler.js";

type TestTarget = {
  id: string;
  user?: { id: string; username?: string; bot?: boolean };
  roles?: { highest?: { position?: number } };
  timeout?: (duration: number | null, reason?: string) => Promise<unknown>;
  kick?: (reason?: string) => Promise<unknown>;
  ban?: (options?: { reason?: string }) => Promise<unknown>;
};

type TestGuildExtra = {
  bans?: { remove(userId: string, reason?: string): Promise<unknown> };
  channels?: { fetch(channelId: string): Promise<{ send?: (payload: unknown) => Promise<unknown> } | null> };
};

function options(userId: string, reason: string | null = null) {
  return {
    getUser: () => ({ id: userId, username: "target" }),
    getString: () => reason,
    getInteger: () => null,
    getAttachment: () => null
  };
}

function guildWithTarget(
  target: TestTarget,
  extra: TestGuildExtra = {}
) {
  return {
    id: "guild-1",
    ownerId: "owner-1",
    members: {
      me: {
        id: "bot-1",
        roles: { highest: { position: 100 } },
        permissions: { has: () => true }
      },
      fetch: async () => target
    },
    ...extra
  };
}

function interaction(commandName: string, guild: ReturnType<typeof guildWithTarget>, reason: string | null = null) {
  return {
    commandName,
    guild,
    user: { id: "admin-1", username: "admin" },
    member: { id: "admin-1", roles: { highest: { position: 90 } } },
    options: options("user-1", reason),
    reply: async (payload: unknown) => payload
  };
}

test("remove-timeout restaureaza sanctiunea Discord daca persistenta nu confirma eliminarea", async () => {
  const timeoutCalls: Array<number | null> = [];
  const activeRecord = {
    userId: "user-1",
    username: "target",
    moderatorId: "admin-1",
    appliedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    reason: "motiv"
  };
  const target = {
    id: "user-1",
    user: { id: "user-1", username: "target" },
    roles: { highest: { position: 10 } },
    timeout: async (duration: number | null) => {
      timeoutCalls.push(duration);
    }
  };
  const handler = moderationInteractionHandler.createModerationInteractionHandler({
    GuildModel: {
      findOne: async () => ({ moderationTimeouts: [activeRecord] }),
      findOneAndUpdate: async () => null,
      updateOne: async () => ({ modifiedCount: 1 })
    },
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async (_value, payload) => payload
  });

  await assert.rejects(
    handler.handle(interaction("remove-timeout", guildWithTarget(target))),
    /persistenta/
  );

  assert.equal(timeoutCalls[0], null);
  assert.equal(typeof timeoutCalls[1], "number");
  assert.ok((timeoutCalls[1] ?? 0) > 0);
});

test("/warn-list grupeaza dupa utilizator: total activ per user, sortat descrescator, o singura intrare (raport post-#699, #5)", async () => {
  const replies: Array<{ content?: string }> = [];
  const base = Date.parse("2026-07-16T12:00:00.000Z");
  const handler = moderationInteractionHandler.createModerationInteractionHandler({
    GuildModel: {
      findOne: async () => ({
        moderationTimeouts: [],
        moderationMutes: [],
        moderationWarnings: [
          { warningId: "w1", userId: "user-1", username: "repeat-offender", moderatorId: "mod-1", warnedAt: new Date(base - 3_000) },
          { warningId: "w2", userId: "user-2", username: "one-timer", moderatorId: "mod-1", warnedAt: new Date(base - 2_000) },
          { warningId: "w3", userId: "user-1", username: "repeat-offender", moderatorId: "mod-2", warnedAt: new Date(base - 1_000) },
          { warningId: "w4", userId: "user-1", username: "repeat-offender-renamed", moderatorId: "mod-1", warnedAt: new Date(base) }
        ]
      }),
      findOneAndUpdate: async () => null,
      updateOne: async () => ({ modifiedCount: 1 })
    },
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => ({}),
    safeDefer: async () => undefined,
    safeEdit: async (_value, payload) => payload
  });
  const guild = guildWithTarget({ id: "user-1" });
  const listInteraction = {
    ...interaction("warn-list", guild),
    reply: async (payload: { content?: string }) => { replies.push(payload); return payload; }
  };

  await handler.handle(listInteraction);

  assert.equal(replies.length, 1);
  const lines = (replies[0].content ?? "").split("\n");
  assert.equal(lines.length, 2, "un utilizator cu mai multe warn-uri apare O SINGURA data");
  assert.match(lines[0], /user-1/);
  assert.match(lines[0], /3 warn-uri active/, "totalul activ e calculat per utilizator");
  assert.match(lines[0], /repeat-offender-renamed/, "se afiseaza numele de la ultimul warn");
  assert.match(lines[1], /user-2/);
  assert.match(lines[1], /1 warn activ/);
  assert.ok(lines[0].indexOf("user-1") >= 0 && lines[1].indexOf("user-2") >= 0, "sortare descrescatoare dupa numarul de warn-uri");
});

test("warn-ul compenseaza exact inregistrarea curenta daca livrarea pe canal esueaza", async () => {
  let rollbackFilter: Record<string, unknown> | null = null;
  let rollbackUpdate: Record<string, unknown> | readonly Record<string, unknown>[] | null = null;
  const target = {
    id: "user-1",
    user: { id: "user-1", username: "target" },
    roles: { highest: { position: 10 } }
  };
  const handler = moderationInteractionHandler.createModerationInteractionHandler({
    GuildModel: {
      findOne: async () => null,
      findOneAndUpdate: async (filter, update) => {
        if ("moderationWarnings.warningId" in filter) {
          rollbackFilter = filter;
          rollbackUpdate = update;
          return { moderationWarnings: [] };
        }
        return {
          moderationWarnings: [{
            warningId: "generated",
            userId: "user-1",
            username: "target",
            moderatorId: "admin-1",
            warnedAt: new Date()
          }],
          moderationWarnBanLimit: 0
        };
      },
      updateOne: async () => ({ modifiedCount: 1 })
    },
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => ({ warningChannelId: "warn-channel" }),
    safeDefer: async () => undefined,
    safeEdit: async (_value, payload) => payload
  });
  const guild = guildWithTarget(target, {
    channels: {
      fetch: async () => ({
        send: async () => {
          throw new Error("delivery failed");
        }
      })
    }
  });

  await assert.rejects(handler.handle(interaction("warn", guild, "motiv valid")), /delivery failed/);

  assert.ok(rollbackFilter);
  const warningId = rollbackFilter["moderationWarnings.warningId"];
  assert.equal(typeof warningId, "string");
  assert.match(JSON.stringify(rollbackUpdate), new RegExp(String(warningId)));
});

test("unban foloseste API-ul de bans al guild-ului fara a cere membrul prezent", async () => {
  const removals: Array<{ userId: string; reason?: string }> = [];
  const replies: unknown[] = [];
  const handler = moderationInteractionHandler.createModerationInteractionHandler({
    GuildModel: {
      findOne: async () => null,
      findOneAndUpdate: async () => null,
      updateOne: async () => ({ modifiedCount: 1 })
    },
    MessageFlags: { Ephemeral: 64 },
    getGuildSettings: async () => null,
    safeDefer: async () => undefined,
    safeEdit: async (_value, payload) => {
      replies.push(payload);
      return payload;
    }
  });
  const guild = guildWithTarget({ id: "unused" }, {
    bans: {
      remove: async (userId: string, reason?: string) => {
        removals.push({ userId, reason });
      }
    }
  });

  await handler.handle(interaction("unban", guild, "apel acceptat"));

  assert.deepEqual(removals, [{ userId: "user-1", reason: "apel acceptat" }]);
  assert.match(String(replies[0]), /debanat/);
});
