import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, firstHeaderValue } from "../app/health/rateLimit";

const attachCommandUi = require("../features/command-presentation/commandPresentation") as {
  createCommandPresentation: (ctx: Record<string, any>) => Record<string, any>;
};

// ============================================================================
// Embed builders: stub EmbedBuilder care inregistreaza setDescription pentru
// a putea asserta textul produs.
// ============================================================================

function makeRecordingEmbed() {
  const state: Record<string, unknown> = {};
  const embed: any = {};
  for (const m of ["setColor", "setTitle", "setFooter", "setURL", "setImage", "setThumbnail", "setTimestamp", "setAuthor", "addFields"]) {
    embed[m] = (...args: unknown[]) => { state[m] = args.length === 1 ? args[0] : args; return embed; };
  }
  embed.setDescription = (val: unknown) => { state.description = val; return embed; };
  embed._state = state;
  return embed;
}

function makePresentationCtx() {
  const embeds: any[] = [];
  const ctx: Record<string, any> = {
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
  const ui = attachCommandUi.createCommandPresentation(ctx);
  return { ui, embeds };
}

// ============================================================================
// Fix #4: buildDealEmbed guard numeric pe savings/qualityScore/totalReviews.
// (commandPresentation.ts:203-216)
// ============================================================================

test("buildDealEmbed: savings undefined/null/NaN nu produce 'undefined%' sau 'NaN%'", () => {
  const { ui, embeds } = makePresentationCtx();
  for (const badSavings of [undefined, null, NaN, "abc"]) {
    embeds.length = 0;
    ui.buildDealEmbed(
      { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: badSavings, link: "https://x" } as any,
      "detailed",
      "USD"
    );
    const desc = String(embeds[0]._state.description);
    assert.doesNotMatch(desc, /undefined%|NaN%/, `savings=${JSON.stringify(badSavings)} → ${desc}`);
    assert.match(desc, /reducere de \*\*0%\*\*/, "fallback la 0% pe savings invalid");
  }
});

test("buildDealEmbed: savings numeric valid se afiseaza rotunjit", () => {
  const { ui, embeds } = makePresentationCtx();
  ui.buildDealEmbed(
    { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: 49.7, qualityScore: 92.4, totalReviews: 1500, link: "https://x" } as any,
    "detailed",
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /reducere de \*\*50%\*\*/, "savings 49.7 → 50 rotunjit");
  assert.match(desc, /Calitate:\*\* 92% aprecieri/, "qualityScore rotunjit");
  assert.match(desc, /1500 recenzii/);
});

test("buildDealEmbed: qualityScore string nu produce 'NaN% aprecieri'", () => {
  const { ui, embeds } = makePresentationCtx();
  ui.buildDealEmbed(
    { title: "Game", store: "Steam", salePrice: "10", normalPrice: "20", savings: 50, qualityScore: "bogus", totalReviews: "bad", link: "https://x" } as any,
    "detailed",
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.doesNotMatch(desc, /NaN/, "qualityScore invalid nu trebuie sa apara ca NaN");
  // qualityScore invalid → sectiunea de stats e omisa.
  assert.doesNotMatch(desc, /Calitate:/);
});

// ============================================================================
// Fix #5: buildSteamPriceEmbed guard pe initial/final/discount_percent.
// (commandPresentation.ts:410-423)
// ============================================================================

test("buildSteamPriceEmbed: price_overview cu initial/final lipsa → 'Pretul nu este disponibil'", () => {
  const { ui, embeds } = makePresentationCtx();
  ui.buildSteamPriceEmbed(
    { type: "game", name: "Demo", is_free: false, price_overview: { discount_percent: 50 } as any },
    "100",
    null,
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /Pretul nu este disponibil/, "fara initial/final → indisponibil, nu NaN");
  assert.doesNotMatch(desc, /NaN/);
});

test("buildSteamPriceEmbed: discount_percent lipsa dar final < initial → derivat din preturi", () => {
  const { ui, embeds } = makePresentationCtx();
  ui.buildSteamPriceEmbed(
    { type: "game", name: "Demo", is_free: false, price_overview: { initial: 2000, final: 1000 } as any },
    "100",
    null,
    "USD"
  );
  const desc = String(embeds[0]._state.description);
  assert.match(desc, /reducere activa de \*\*50%\*\*/, "discount derivat 50% din preturi");
});

test("buildSteamPriceEmbed: pret valid fara reducere", () => {
  const { ui, embeds } = makePresentationCtx();
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

// ============================================================================
// Fix #2: rate limiter X-Forwarded-For — rightmost trusted hop + socket fallback.
// (rateLimit.ts:20-31)
// ============================================================================

function makeReq(opts: { xff?: string | string[]; remote?: string }) {
  return {
    headers: opts.xff !== undefined ? { "x-forwarded-for": opts.xff } : {},
    socket: { remoteAddress: opts.remote }
  } as any;
}

function makeRateLimiter(trustProxy: boolean) {
  const env: any = { HTTP_RATE_LIMIT_REQ: 5, HTTP_RATE_LIMIT_WINDOW_MS: 60_000, TRUST_PROXY: trustProxy };
  const metrics: any = { httpRateLimitDrops: 0 };
  return { rl: createRateLimiter(env, metrics), metrics };
}

test("rateLimit: cu trustProxy, foloseste ultimul hop din XFF (anti-spoof)", () => {
  // Client trimite XFF spoofat; proxy appendeaza IP-ul real la sfarsit.
  // Bucket-ul trebuie sa fie keyed pe IP-ul real (ultimul), nu pe cel spoofat.
  const { rl } = makeRateLimiter(true);
  // Doua requesturi cu acelasi IP real (ultimul) dar leftmost spoofat diferit
  // → trebuie sa imparta acelasi bucket. Cu cap=5, 6 requesturi → al 6-lea drop.
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check(makeReq({ xff: `spoof${i}, 9.9.9.9` })), true, `req ${i}`);
  }
  assert.equal(rl.check(makeReq({ xff: "spoofX, 9.9.9.9" })), false,
    "al 6-lea request pe acelasi IP real (ultimul hop) trebuie dropat — leftmost spoof nu creeaza bucket-uri noi");
});

test("rateLimit: XFF gol/whitespace cade pe socket, nu pe bucket 'unknown' partajat", () => {
  const { rl } = makeRateLimiter(true);
  // Doua IP-uri socket diferite cu XFF gol → bucket-uri separate, nu colaps pe "unknown".
  for (let i = 0; i < 5; i++) assert.equal(rl.check(makeReq({ xff: "   ", remote: "1.1.1.1" })), true);
  // Al 6-lea pe 1.1.1.1 e dropat.
  assert.equal(rl.check(makeReq({ xff: "   ", remote: "1.1.1.1" })), false);
  // Dar 2.2.2.2 (socket diferit) inca are bucket plin.
  assert.equal(rl.check(makeReq({ xff: ",,", remote: "2.2.2.2" })), true,
    "IP socket diferit cu XFF gol NU trebuie sa imparta bucket cu 1.1.1.1");
});

test("rateLimit: fara trustProxy, ignora XFF si foloseste socket", () => {
  const { rl } = makeRateLimiter(false);
  // XFF spoofat e ignorat; toate vin de pe acelasi socket → acelasi bucket.
  for (let i = 0; i < 5; i++) assert.equal(rl.check(makeReq({ xff: `evil${i}`, remote: "3.3.3.3" })), true);
  assert.equal(rl.check(makeReq({ xff: "evilX", remote: "3.3.3.3" })), false);
});

test("firstHeaderValue: array → primul element, string → ca atare, undefined → null", () => {
  assert.equal(firstHeaderValue(["a", "b"]), "a");
  assert.equal(firstHeaderValue("x"), "x");
  assert.equal(firstHeaderValue(undefined), null);
  assert.equal(firstHeaderValue([]), null);
});
