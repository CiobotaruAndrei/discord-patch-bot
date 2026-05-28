import test from "node:test";
import assert from "node:assert/strict";

const attachAdminAlerts = require("../infra/mongo/adminAlerts") as
  (ctx: Record<string, any>) => void;

type CooldownDoc = { _id: string; lastSentAt: Date };

function makeAdminAlertsCtx(opts: {
  axiosPostFails?: boolean;
  initialCooldown?: CooldownDoc | null;
}) {
  const updates: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> = [];
  const creates: CooldownDoc[] = [];
  const posts: Array<{ url: string; payload: unknown }> = [];
  const logs: Array<{ level: string; ctx: string; msg: string }> = [];

  let cooldownState: CooldownDoc | null = opts.initialCooldown || null;

  const AdminAlertCooldownModel = {
    async findOneAndUpdate(filter: Record<string, any>, update: Record<string, any>) {

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
    async updateOne(filter: Record<string, any>, update: Record<string, any>) {
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

  const ctx: Record<string, any> = {
    env: { ADMIN_WEBHOOK_URL: "https://discord.example/webhook", ADMIN_ALERT_COOLDOWN_MS: 60_000 },
    AdminAlertCooldownModel,
    axios,
    logger: (level: string, c: string, msg: string) => { logs.push({ level, ctx: c, msg }); }
  };
  attachAdminAlerts(ctx);
  return {
    adminAlert: ctx.adminAlert as (kind: string, title: string, body: unknown) => Promise<void>,
    updates, creates, posts, logs,
    getCooldownState: () => cooldownState
  };
}

test("adminAlert resets cooldown when webhook POST fails (transient 5xx / timeout)", async () => {

  const { adminAlert, updates, posts, logs, getCooldownState } = makeAdminAlertsCtx({
    axiosPostFails: true
  });

  await adminAlert("cron:fatal", "Cron a esuat", "Mongo down");

  assert.equal(posts.length, 1, "webhook trebuie sa fie incercat");

  const resetCall = updates.find(u => (u.update as any).$set?.lastSentAt?.getTime() === 0);
  assert.ok(resetCall, "cooldown trebuie resetat la epoch dupa webhook fail");
  assert.equal((resetCall!.filter as any)._id, "cron:fatal");

  assert.ok(logs.some(l => l.level === "WARN" && /webhook/i.test(l.msg)),
    "trebuie sa loghez WARN pe esec webhook");

  const state = getCooldownState();
  assert.ok(state && state.lastSentAt.getTime() === 0,
    "cooldownState lastSentAt trebuie sa fie epoch dupa reset");
});

test("adminAlert does NOT reset cooldown when webhook succeeds", async () => {

  const { adminAlert, updates, posts, getCooldownState } = makeAdminAlertsCtx({
    axiosPostFails: false
  });

  await adminAlert("boot:fatal", "Boot esuat", "config invalid");

  assert.equal(posts.length, 1);
  const resetCall = updates.find(u => (u.update as any).$set?.lastSentAt?.getTime() === 0);
  assert.equal(resetCall, undefined, "pe success NU resetam cooldown-ul");
  const state = getCooldownState();
  assert.ok(state && state.lastSentAt.getTime() > 0,
    "cooldownState lastSentAt trebuie sa fie pastrat (recent) pe success");
});

test("adminAlert skip when ADMIN_WEBHOOK_URL is empty", async () => {
  const ctx: Record<string, any> = {
    env: { ADMIN_WEBHOOK_URL: "", ADMIN_ALERT_COOLDOWN_MS: 60_000 },
    AdminAlertCooldownModel: {
      findOneAndUpdate: async () => { throw new Error("trebuie sa nu fie apelat"); },
      create: async () => { throw new Error("trebuie sa nu fie apelat"); },
      updateOne: async () => { throw new Error("trebuie sa nu fie apelat"); }
    },
    axios: { post: async () => { throw new Error("trebuie sa nu fie apelat"); } },
    logger: () => undefined
  };
  attachAdminAlerts(ctx);

  await ctx.adminAlert("any", "any", "any");
});
