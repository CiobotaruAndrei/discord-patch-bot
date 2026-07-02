import test from "node:test";
import assert from "node:assert/strict";

import type { LifecycleDiscordChannel } from "../app/lifecycle/lifecycleContracts";

const mod = require("../app/lifecycle/guildOnboarding") as typeof import("../app/lifecycle/guildOnboarding");
const { buildOnboardingEmbed, selectOnboardingChannel, createGuildOnboarding } = mod;

interface FakeChannel { id: string; sendable: boolean; send?: (payload: unknown) => Promise<unknown>; }

function makeChannel(id: string, sendable: boolean, onSend?: (payload: unknown) => void): FakeChannel {
  return {
    id,
    sendable,
    send: async (payload: unknown) => { if (onSend) onSend(payload); return undefined; }
  };
}

const canSend = (channel: LifecycleDiscordChannel, botId: string): boolean => botId === "bot" && (channel as FakeChannel)?.sendable === true;

function makeGuild(opts: { system?: FakeChannel | null; others?: FakeChannel[]; botId?: string | null }) {
  const others = opts.others || [];
  return {
    id: "g1",
    name: "Test Guild",
    systemChannel: opts.system ?? null,
    channels: { cache: { find: (predicate: (channel: LifecycleDiscordChannel) => boolean) => others.find(predicate) } },
    client: { user: opts.botId === undefined ? { id: "bot" } : (opts.botId === null ? null : { id: opts.botId }) }
  };
}

test("buildOnboardingEmbed contine pasii de configurare cheie", () => {
  const embed = buildOnboardingEmbed();
  assert.match(embed.description, /\/start updates/);
  assert.match(embed.description, /\/start reduceri/);
  assert.match(embed.description, /\/set games add/);
  assert.match(embed.description, /\/set role/);
  assert.match(embed.description, /\/help/);
  assert.match(embed.description, /\/history/);
  assert.match(embed.footer.text, /Send Messages/);
  assert.equal(typeof embed.color, "number");
});

test("selectOnboardingChannel prefera systemChannel daca poate posta acolo", () => {
  const system = makeChannel("sys", true);
  const guild = makeGuild({ system, others: [makeChannel("other", true)] });
  assert.equal(selectOnboardingChannel(guild, "bot", canSend), system);
});

test("selectOnboardingChannel cade pe primul canal trimisibil daca systemChannel nu e bun", () => {
  const good = makeChannel("good", true);
  const guild = makeGuild({ system: makeChannel("sys", false), others: [makeChannel("bad", false), good] });
  assert.equal(selectOnboardingChannel(guild, "bot", canSend), good);
});

test("selectOnboardingChannel: null cand nu exista botId sau niciun canal trimisibil", () => {
  assert.equal(selectOnboardingChannel(makeGuild({ system: makeChannel("s", true) }), "", canSend), null);
  assert.equal(selectOnboardingChannel(makeGuild({ system: makeChannel("s", false), others: [makeChannel("o", false)] }), "bot", canSend), null);
});

test("selectOnboardingChannel: canal cu permisiuni dar FARA functie send e sarit (review #13.2)", () => {
  const noSendSystem: FakeChannel = { id: "sys-broken", sendable: true };
  const good = makeChannel("good", true);
  const guild = makeGuild({ system: noSendSystem, others: [noSendSystem, good] });
  assert.equal(selectOnboardingChannel(guild, "bot", canSend), good,
    "canalul fara send nu mai e castat orbeste; se alege urmatorul canal real trimisibil");
});

test("handleGuildCreate trimite embed-ul pe canalul ales si logheaza INFO", async () => {
  const sent: unknown[] = [];
  const logs: string[] = [];
  const onboarding = createGuildOnboarding({
    logger: (level, _ctx, msg) => logs.push(`${level}:${msg}`),
    canSendEmbeds: canSend,
    errorMessage: err => String(err)
  });
  const guild = makeGuild({ system: makeChannel("sys", true, payload => sent.push(payload)) });
  await onboarding.handleGuildCreate(guild);
  assert.equal(sent.length, 1);
  assert.ok((sent[0] as { embeds?: unknown[] }).embeds, "trimite un payload cu embeds");
  assert.ok(logs.some(l => l.startsWith("INFO:") && /bun venit/.test(l)));
});

test("handleGuildCreate nu trimite si nu arunca cand nu exista canal trimisibil", async () => {
  const logs: string[] = [];
  const onboarding = createGuildOnboarding({
    logger: (level, _ctx, msg) => logs.push(`${level}:${msg}`),
    canSendEmbeds: canSend,
    errorMessage: err => String(err)
  });
  await onboarding.handleGuildCreate(makeGuild({ system: makeChannel("s", false), others: [] }));
  assert.ok(logs.some(l => l.startsWith("INFO:") && /niciun canal/.test(l)));
});

test("handleGuildCreate prinde erorile de send (best-effort, logheaza WARN)", async () => {
  const logs: string[] = [];
  const onboarding = createGuildOnboarding({
    logger: (level, _ctx, msg) => logs.push(`${level}:${msg}`),
    canSendEmbeds: canSend,
    errorMessage: err => String(err)
  });
  const throwingChannel = { id: "x", sendable: true, send: async () => { throw new Error("forbidden"); } };
  const guild = makeGuild({ system: throwingChannel });
  await onboarding.handleGuildCreate(guild);
  assert.ok(logs.some(l => l.startsWith("WARN:")));
});

test("handleGuildCreate iese curat cand clientul nu are inca user.id", async () => {
  const sent: unknown[] = [];
  const onboarding = createGuildOnboarding({
    logger: () => undefined,
    canSendEmbeds: canSend,
    errorMessage: err => String(err)
  });
  const guild = makeGuild({ system: makeChannel("sys", true, payload => sent.push(payload)), botId: null });
  await onboarding.handleGuildCreate(guild);
  assert.equal(sent.length, 0);
});
