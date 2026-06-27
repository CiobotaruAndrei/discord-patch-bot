import test from "node:test";
import assert from "node:assert/strict";
import type { BotMetrics, RuntimeEnv } from "../types";
import { createRateLimiter, firstHeaderValue } from "../app/health/rateLimit";

type CommandPresentation = {
  buildDealEmbed: (...args: unknown[]) => unknown;
  buildSteamPriceEmbed: (...args: unknown[]) => unknown;
  safeEdit: (interaction: unknown, payload: unknown) => Promise<unknown>;
};
type RecordingEmbed = Record<string, unknown> & { _state: Record<string, unknown> };

const attachCommandUi = require("../features/command-presentation/commandPresentation") as {
  createCommandPresentation: (context: Record<string, unknown>) => CommandPresentation;
};

function makeRecordingEmbed() {
  const state: Record<string, unknown> = {};
  const embed: RecordingEmbed = { _state: state };
  for (const m of ["setColor", "setTitle", "setFooter", "setURL", "setImage", "setThumbnail", "setTimestamp", "setAuthor", "addFields"]) {
    embed[m] = (...args: unknown[]) => { state[m] = args.length === 1 ? args[0] : args; return embed; };
  }
  embed.setDescription = (val: unknown) => { state.description = val; return embed; };
  return embed;
}

function makePresentationContext() {
  const embeds: RecordingEmbed[] = [];
  const context = {
    crypto: { randomBytes: () => ({ toString: () => "abcd1234" }) },
    EmbedBuilder: class { constructor() { const e = makeRecordingEmbed(); embeds.push(e); return e; } },
    ActionRowBuilder: class { addComponents() { return this; } },
    ButtonBuilder: class { setCustomId() { return this; } setLabel() { return this; } setStyle() { return this; } setDisabled() { return this; } },
    ButtonStyle: { Primary: 1, Secondary: 2 },
    ComponentType: { Button: 2 },
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    checkUserCooldown: () => ({ allowed: true }),
    COLORS: { SUCCESS: 1, ERROR: 2, FREE: 3, DARK: 4 },
    truncate: (v: unknown, max: number) => String(v ?? "").slice(0, max),
    DEFAULT_CURRENCY: "USD",
    formatPrice: (v: unknown, _cur?: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$—";
    },
    COLLECTOR_TIMEOUT_MS: 60_000,
    MAX_FUZZY_SEARCH_INPUT: 100,
    httpReq: async () => ({ data: {} })
  };
  const ui = attachCommandUi.createCommandPresentation(context);
  return { ui, embeds };
}

test("safeEdit: cand editReply esueaza, trimite un followUp ephemeral de fallback (nu lasa userul fara raspuns)", async () => {
  const { ui } = makePresentationContext();
  const followUps: Array<Record<string, unknown>> = [];
  const interaction = {
    deferred: true,
    replied: false,
    editReply: async () => { throw new Error("Invalid Form Body (mesaj prea lung)"); },
    followUp: async (payload: Record<string, unknown>) => { followUps.push(payload); return {}; }
  };
  const result = await ui.safeEdit(interaction, { content: "x".repeat(5000) });
  assert.equal(result, null, "safeEdit intoarce null la esec");
  assert.equal(followUps.length, 1, "s-a trimis un followUp de fallback");
  assert.equal(followUps[0].flags, 64, "fallback-ul e ephemeral");
  assert.match(String(followUps[0].content), /nu am putut afisa/i);
});

test("safeEdit: daca si followUp-ul de fallback esueaza, nu arunca (best-effort)", async () => {
  const { ui } = makePresentationContext();
  const interaction = {
    deferred: true,
    replied: false,
    editReply: async () => { throw new Error("edit fail"); },
    followUp: async () => { throw new Error("followUp fail"); }
  };
  const result = await ui.safeEdit(interaction, { content: "x" });
  assert.equal(result, null);
});

test("buildDealEmbed: savings undefined/null/NaN nu produce 'undefined%' sau 'NaN%'", () => {
  const { ui, embeds } = makePresentationContext();
  for (const badSavings of [undefined, null, NaN, "abc"]) {
    embeds.length = 0;
    ui.buildDealEmbed(
      { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: badSavings, link: "https://x" },
      "detailed",
      "USD"
    );
    const desc = String(embeds[0]._state.description);
    assert.doesNotMatch(desc, /undefined%|NaN%/, `savings=${JSON.stringify(badSavings)} → ${desc}`);
    assert.match(desc, /reducere de \*\*0%\*\*/, "fallback la 0% pe savings invalid");
  }
});

test("buildDealEmbed: savings numeric valid se afiseaza rotunjit", () => {
  const { ui, embeds } = makePresentationContext();
  ui.buildDealEmbed(
    { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: 49.7, qualityScore: 92.4, totalReviews: 1500, link: "https://x" },
    "detailed",
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /reducere de \*\*50%\*\*/, "savings 49.7 → 50 rotunjit");
  assert.match(desc, /Calitate:\*\* 92% aprecieri/, "qualityScore rotunjit");
  assert.match(desc, /1500 recenzii/);
});

test("buildDealEmbed: savings peste 100 e clampat la 100% (snapshot corupt nu produce 999%)", () => {
  const { ui, embeds } = makePresentationContext();
  ui.buildDealEmbed(
    { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: 999, link: "https://x" },
    "detailed",
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /reducere de \*\*100%\*\*/, "savings 999 → clampat la 100%");
  assert.doesNotMatch(desc, /999/, "procentul brut corupt nu trebuie sa apara");
});

test("buildDealEmbed: qualityScore string nu produce 'NaN% aprecieri'", () => {
  const { ui, embeds } = makePresentationContext();
  ui.buildDealEmbed(
    { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: 50, qualityScore: "bogus", totalReviews: "bad", link: "https://x" },
    "detailed",
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.doesNotMatch(desc, /NaN/, "qualityScore invalid nu trebuie sa apara ca NaN");

  assert.doesNotMatch(desc, /Calitate:/);
});

test("buildSteamPriceEmbed: price_overview cu initial/final lipsa → 'Pretul nu este disponibil'", () => {
  const { ui, embeds } = makePresentationContext();
  ui.buildSteamPriceEmbed(
    { type: "game", name: "Demo", is_free: false, price_overview: { discount_percent: 50 } },
    "100",
    null,
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /Pretul nu este disponibil/, "fara initial/final → indisponibil, nu NaN");
  assert.doesNotMatch(desc, /NaN/);
});

test("buildSteamPriceEmbed: discount_percent lipsa dar final < initial → derivat din preturi", () => {
  const { ui, embeds } = makePresentationContext();
  ui.buildSteamPriceEmbed(
    { type: "game", name: "Demo", is_free: false, price_overview: { initial: 2000, final: 1000 } },
    "100",
    null,
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /reducere activa de \*\*50%\*\*/, "discount derivat 50% din preturi");
});

test("buildSteamPriceEmbed: pret valid fara reducere", () => {
  const { ui, embeds } = makePresentationContext();
  ui.buildSteamPriceEmbed(
    { type: "game", name: "Demo", is_free: false, price_overview: { initial: 1000, final: 1000, discount_percent: 0 } },
    "100",
    null,
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /Nu este la reducere/);
  assert.doesNotMatch(desc, /NaN/);
});

function makeReq(opts: { xff?: string | string[]; remote?: string }) {
  return {
    headers: opts.xff !== undefined ? { "x-forwarded-for": opts.xff } : {},
    socket: { remoteAddress: opts.remote }
  };
}

function makeRateLimiter(trustProxy: boolean, trustedProxyCount = 1) {
  const env = { HTTP_RATE_LIMIT_REQ: 5, HTTP_RATE_LIMIT_WINDOW_MS: 60_000, TRUST_PROXY: trustProxy, TRUSTED_PROXY_COUNT: trustedProxyCount } as RuntimeEnv;
  const metrics = { httpRateLimitDrops: 0 } as BotMetrics;
  return { rl: createRateLimiter(env, metrics), metrics };
}

test("rateLimit: 1 proxy trusted -> ia hop-ul adaugat de proxy (rightmost), spoof-ul leftmost e ignorat", () => {
  const { rl } = makeRateLimiter(true, 1);
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check(makeReq({ xff: `spoof${i}, 9.9.9.9` })), true, `req ${i}`);
  }
  assert.equal(rl.check(makeReq({ xff: "spoofX, 9.9.9.9" })), false,
    "acelasi client real (adaugat de proxy = segments[length-1]) e limitat; spoof-ul leftmost nu creeaza bucket-uri noi");
});

test("rateLimit: single-proxy [client] count=1 -> client (cazul comun, fara spoof)", () => {
  const { rl } = makeRateLimiter(true, 1);
  for (let i = 0; i < 5; i++) assert.equal(rl.check(makeReq({ xff: "client-1.2.3.4" })), true, `req ${i}`);
  assert.equal(rl.check(makeReq({ xff: "client-1.2.3.4" })), false,
    "[client] count=1 -> segments[length-1]=client; al 6-lea request al aceluiasi client e limitat");
  assert.equal(rl.check(makeReq({ xff: "alt-client-5.6.7.8" })), true,
    "un client diferit (single entry) primeste bucket separat");
});

test("rateLimit: mai multe proxy-uri trusted -> extrage clientul real, nu proxy-ul cel mai apropiat", () => {
  const { rl } = makeRateLimiter(true, 2);

  assert.equal(rl.check(makeReq({ xff: "clientA, proxy1" })), true, "clientA distinct");
  assert.equal(rl.check(makeReq({ xff: "clientB, proxy1" })), true, "clientB distinct, NU grupat sub proxy1");
  for (let i = 0; i < 4; i++) {
    assert.equal(rl.check(makeReq({ xff: "clientA, proxy1" })), true, `clientA req ${i}`);
  }
  assert.equal(rl.check(makeReq({ xff: "clientA, proxy1" })), false,
    "al 6-lea request al clientA (segments[length-2]) e limitat — clientii din spatele aceluiasi proxy NU mai sunt grupati");
});

test("rateLimit: spoof leftmost cu mai multe proxy-uri ramane ignorat", () => {
  const { rl } = makeRateLimiter(true, 2);
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check(makeReq({ xff: `spoof${i}, realclient, proxy1` })), true, `req ${i}`);
  }
  assert.equal(rl.check(makeReq({ xff: "spoofZ, realclient, proxy1" })), false,
    "realclient (segments[length-2]) e cel limitat; spoof-ul leftmost variabil nu creeaza bucket-uri noi");
});

test("rateLimit: chain XFF mai scurt decat TRUSTED_PROXY_COUNT -> cade pe socket (anti-truncare)", () => {
  const { rl } = makeRateLimiter(true, 2);
  for (let i = 0; i < 5; i++) assert.equal(rl.check(makeReq({ xff: "doarunul", remote: "1.1.1.1" })), true);
  assert.equal(rl.check(makeReq({ xff: "doarunul", remote: "1.1.1.1" })), false,
    "XFF prea scurt -> folosim socket-ul (nu un hop ne-fiabil)");
});

test("rateLimit: XFF gol/whitespace cade pe socket, nu pe bucket 'unknown' partajat", () => {
  const { rl } = makeRateLimiter(true, 1);

  for (let i = 0; i < 5; i++) assert.equal(rl.check(makeReq({ xff: "   ", remote: "1.1.1.1" })), true);

  assert.equal(rl.check(makeReq({ xff: "   ", remote: "1.1.1.1" })), false);

  assert.equal(rl.check(makeReq({ xff: ",,", remote: "2.2.2.2" })), true,
    "IP socket diferit cu XFF gol NU trebuie sa imparta bucket cu 1.1.1.1");
});

test("rateLimit: fara trustProxy, ignora XFF si foloseste socket", () => {
  const { rl } = makeRateLimiter(false);

  for (let i = 0; i < 5; i++) assert.equal(rl.check(makeReq({ xff: `evil${i}`, remote: "3.3.3.3" })), true);
  assert.equal(rl.check(makeReq({ xff: "evilX", remote: "3.3.3.3" })), false);
});

test("firstHeaderValue: array → primul element, string → ca atare, undefined → null", () => {
  assert.equal(firstHeaderValue(["a", "b"]), "a");
  assert.equal(firstHeaderValue("x"), "x");
  assert.equal(firstHeaderValue(undefined), null);
  assert.equal(firstHeaderValue([]), null);
});
