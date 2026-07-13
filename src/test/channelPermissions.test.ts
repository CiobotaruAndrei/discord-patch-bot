import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/itest-perms";
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "test-token";
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "test-client-id";
process.env.METRICS_PUBLIC = process.env.METRICS_PUBLIC || "true";

import { PermissionsBitField } from "discord.js";
const { checkChannelPermissions, checkReadMessageHistory } = require("../features/command-runtime/commandRuntimeContext").default as {
  checkChannelPermissions: (interaction: unknown, channelId: string) => Promise<{ viewChannel: boolean; sendMessages: boolean; embedLinks: boolean; readMessageHistory: boolean } | null>;
  checkReadMessageHistory: (interaction: unknown, channelId: string) => Promise<boolean | null>;
};

const me = { id: "bot" };

function permsGranting(deniedFlags: unknown[] = []) {
  return { has: (flag: unknown) => !deniedFlags.includes(flag) };
}

function interactionWith(channel: unknown, opts: { hasMe?: boolean; hasChannels?: boolean; cached?: boolean; fetchThrows?: boolean } = {}) {
  const { hasMe = true, hasChannels = true, cached = true, fetchThrows = false } = opts;
  const channels = hasChannels
    ? {
        cache: { get: (_id: string) => (cached ? channel : undefined) },
        fetch: async (_id: string) => { if (fetchThrows) throw new Error("fetch fail"); return channel; }
      }
    : undefined;
  return { guild: { members: { me: hasMe ? me : undefined }, channels } };
}

test("checkChannelPermissions: null (fail-closed) cand lipseste guild / membrul bot / channels", async () => {
  assert.equal(await checkChannelPermissions({}, "c1"), null);
  assert.equal(await checkChannelPermissions({ guild: null }, "c1"), null);
  assert.equal(await checkChannelPermissions(interactionWith({ permissionsFor: () => permsGranting() }, { hasMe: false }), "c1"), null);
  assert.equal(await checkChannelPermissions(interactionWith({ permissionsFor: () => permsGranting() }, { hasChannels: false }), "c1"), null);
});

test("checkChannelPermissions: canal din cache -> booleene corecte din permissionsFor(me)", async () => {
  const channel = { permissionsFor: (member: unknown) => (member === me ? permsGranting() : null) };
  const res = await checkChannelPermissions(interactionWith(channel), "c1");
  assert.deepEqual(res, { viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true });
});

test("checkChannelPermissions: fetch cand nu e in cache; fetch care arunca -> null (fail-closed)", async () => {
  const channel = { permissionsFor: () => permsGranting() };
  const viaFetch = await checkChannelPermissions(interactionWith(channel, { cached: false }), "c1");
  assert.deepEqual(viaFetch, { viewChannel: true, sendMessages: true, embedLinks: true, readMessageHistory: true });

  const thrown = await checkChannelPermissions(interactionWith(channel, { cached: false, fetchThrows: true }), "c1");
  assert.equal(thrown, null);
});

test("checkChannelPermissions: raporteaza viewChannel:false cand View Channel e refuzat (R[Medium] #3)", async () => {
  const channel = { permissionsFor: () => permsGranting([PermissionsBitField.Flags.ViewChannel]) };
  const res = await checkChannelPermissions(interactionWith(channel), "c1");
  assert.deepEqual(res, { viewChannel: false, sendMessages: true, embedLinks: true, readMessageHistory: true });
});

test("checkChannelPermissions: canal fara permissionsFor -> null (fail-closed)", async () => {
  assert.equal(await checkChannelPermissions(interactionWith({}), "c1"), null);
});

test("checkReadMessageHistory: true/false dupa permisiune; null cand permisiunile nu se pot rezolva", async () => {
  const granted = { permissionsFor: () => permsGranting() };
  assert.equal(await checkReadMessageHistory(interactionWith(granted), "c1"), true);

  const denied = { permissionsFor: () => permsGranting([PermissionsBitField.Flags.ReadMessageHistory]) };
  assert.equal(await checkReadMessageHistory(interactionWith(denied), "c1"), false);

  assert.equal(await checkReadMessageHistory({}, "c1"), null);
});
