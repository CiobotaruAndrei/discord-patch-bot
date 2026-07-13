import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import test from "node:test";
import assert from "node:assert/strict";

const attachAdminAlerts = require("../infra/mongo/adminAlerts").default as
  (target: AdminAlertsTarget) => void;

type CooldownDoc = { _id: string; lastSentAt: Date };
type CooldownFilter = { _id: string; lastSentAt?: { $lte: Date } };
type CooldownUpdate = { $set: { lastSentAt: Date } };
type AdminAlertsRuntime = {
  adminAlert: (kind: string, title: string, body: unknown, guildId?: string) => Promise<void>;
  setAdminAlertDiscordClient: (client: {
    user?: { id?: string } | null;
    channels: { fetch(channelId: string): Promise<unknown> | unknown };
  } | null) => void;
};
type AdminAlertsTarget = {
  env: { ADMIN_WEBHOOK_URL: string; ADMIN_ALERT_COOLDOWN_MS: number };
  AdminAlertCooldownModel: {
    findOneAndUpdate: (filter: CooldownFilter, update: CooldownUpdate) => Promise<CooldownDoc | null>;
    create: (doc: CooldownDoc) => Promise<CooldownDoc>;
    updateOne: (filter: Pick<CooldownDoc, "_id">, update: CooldownUpdate) => Promise<{ matchedCount: number; modifiedCount: number }>;
  };
  GuildModel: {
    find: (filter: Record<string, unknown>) => { lean: () => Promise<Array<{ _id: string; adminAlertChannelId?: string | null }>> };
    updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<unknown>;
  };
  axios: { post: (url: string, payload: unknown) => Promise<{ status: number }> };
  logger: (level: string, context: string, msg: string) => void;
} & Partial<AdminAlertsRuntime>;

function makeAdminAlertsContext(opts: {
  axiosPostFails?: boolean;
  initialCooldown?: CooldownDoc | null;
  webhookUrl?: string;
  guilds?: Array<{ _id: string; adminAlertChannelId?: string | null }>;
}) {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const creates: CooldownDoc[] = [];
  const posts: Array<{ url: string; payload: unknown }> = [];
  const logs: Array<{ level: string; context: string; msg: string }> = [];

  let cooldownState: CooldownDoc | null = opts.initialCooldown || null;

  const AdminAlertCooldownModel = {
    async findOneAndUpdate(filter: CooldownFilter, update: CooldownUpdate) {

      if (cooldownState && cooldownState._id === filter._id) {
        const threshold = filter.lastSentAt?.$lte;
        if (!threshold || cooldownState.lastSentAt <= threshold) {
          const prior = { ...cooldownState };
          cooldownState = { ...cooldownState, lastSentAt: update.$set.lastSentAt };
          return prior;
        }
        return null;
      }
      return null;
    },
    async create(doc: CooldownDoc) {
      if (cooldownState && cooldownState._id === doc._id) {
        const err = new Error("E11000 duplicate key") as Error & { code: number };
        err.code = 11000;
        throw err;
      }
      cooldownState = { ...doc };
      creates.push({ ...doc });
      return doc;
    },
    async updateOne(filter: Pick<CooldownDoc, "_id">, update: CooldownUpdate) {
      updates.push({ filter, update });
      if (cooldownState && cooldownState._id === filter._id) {
        cooldownState = { ...cooldownState, lastSentAt: update.$set.lastSentAt };
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };

  const axios = {
    async post(url: string, payload: unknown) {
      posts.push({ url, payload });
      if (opts.axiosPostFails) {
        throw new Error("simulated webhook 503");
      }
      return { status: 204 };
    }
  };

  const target: AdminAlertsTarget = {
    env: { ADMIN_WEBHOOK_URL: opts.webhookUrl ?? "https://discord.example/webhook", ADMIN_ALERT_COOLDOWN_MS: 60_000 },
    AdminAlertCooldownModel,
    GuildModel: {
      find: () => ({ lean: async () => opts.guilds || [] }),
      updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 })
    },
    axios,
    logger: (level: string, context: string, msg: string) => { logs.push({ level, context, msg }); }
  };
  attachAdminAlerts(target);
  const runtime = target as AdminAlertsTarget & AdminAlertsRuntime;
  return {
    adminAlert: runtime.adminAlert,
    setAdminAlertDiscordClient: runtime.setAdminAlertDiscordClient,
    updates, creates, posts, logs,
    getCooldownState: () => cooldownState
  };
}

test("adminAlert resets cooldown when webhook POST fails (transient 5xx / timeout)", async () => {

  const { adminAlert, updates, posts, logs, getCooldownState } = makeAdminAlertsContext({
    axiosPostFails: true
  });

  await adminAlert("cron:fatal", "Cron a esuat", "Mongo down");

  assert.equal(posts.length, 1, "webhook trebuie sa fie incercat");

  const resetCall = updates.find(u => (u.update as CooldownUpdate).$set.lastSentAt.getTime() === 0);
  assert.ok(resetCall, "cooldown trebuie resetat la epoch dupa webhook fail");
  assert.equal((resetCall!.filter as Pick<CooldownDoc, "_id">)._id, "cron:fatal");

  assert.ok(logs.some(l => l.level === "WARN" && /webhook/i.test(l.msg)),
    "trebuie sa loghez WARN pe esec webhook");

  const state = getCooldownState();
  assert.ok(state && state.lastSentAt.getTime() === 0,
    "cooldownState lastSentAt trebuie sa fie epoch dupa reset");
});

test("adminAlert does NOT reset cooldown when webhook succeeds", async () => {

  const { adminAlert, updates, posts, getCooldownState } = makeAdminAlertsContext({
    axiosPostFails: false
  });

  await adminAlert("boot:fatal", "Boot esuat", "config invalid");

  assert.equal(posts.length, 1);
  const resetCall = updates.find(u => (u.update as CooldownUpdate).$set.lastSentAt.getTime() === 0);
  assert.equal(resetCall, undefined, "pe success NU resetam cooldown-ul");
  const state = getCooldownState();
  assert.ok(state && state.lastSentAt.getTime() > 0,
    "cooldownState lastSentAt trebuie sa fie pastrat (recent) pe success");
});

test("adminAlert skip when ADMIN_WEBHOOK_URL is empty", async () => {
  const target: AdminAlertsTarget = {
    env: { ADMIN_WEBHOOK_URL: "", ADMIN_ALERT_COOLDOWN_MS: 60_000 },
    AdminAlertCooldownModel: {
      findOneAndUpdate: async () => { throw new Error("trebuie sa nu fie apelat"); },
      create: async () => { throw new Error("trebuie sa nu fie apelat"); },
      updateOne: async () => { throw new Error("trebuie sa nu fie apelat"); }
    },
    GuildModel: {
      find: () => ({ lean: async () => [] }),
      updateOne: async () => ({ matchedCount: 0, modifiedCount: 0 })
    },
    axios: { post: async () => { throw new Error("trebuie sa nu fie apelat"); } },
    logger: () => undefined
  };
  attachAdminAlerts(target);
  const runtime = target as AdminAlertsTarget & AdminAlertsRuntime;

  await runtime.adminAlert("test", "test", "test");
});

test("adminAlert trimite in canalul Discord configurat pentru guild-ul cerut", async () => {
  const sent: unknown[] = [];
  const runtime = makeAdminAlertsContext({
    webhookUrl: "",
    guilds: [{ _id: "guild-1", adminAlertChannelId: "admin-channel" }]
  });
  runtime.setAdminAlertDiscordClient({
    user: { id: "bot-1" },
    channels: {
      fetch: async channelId => ({
        send: async (payload: unknown) => {
          assert.equal(channelId, "admin-channel");
          sent.push(payload);
          return { id: "message-1" };
        }
      })
    }
  });

  await runtime.adminAlert("feedback:report", "Raport nou", "Detalii", "guild-1");

  assert.equal(sent.length, 1);
  assert.match(JSON.stringify(sent[0]), /Raport nou/);
  runtime.setAdminAlertDiscordClient(null);
});
