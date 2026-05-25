import test from "node:test";
import assert from "node:assert/strict";

type DlcModule = ((ctx: Record<string, any>) => void) & {
  createDlcInteractionHandler: (deps: Record<string, any>) => {
    handleDlcInteraction: (interaction: Record<string, any>) => Promise<unknown>;
  };
};

const dlcHandler = require("../features/command-handlers/dlcInteractionHandler") as DlcModule;

function makeDlcInteraction(gameText: string | null = "cs2") {
  const replies: unknown[] = [];
  return {
    interaction: {
      commandName: "dlc",
      guild: { id: "guild-1" },
      user: { id: "user-1" },
      deferred: false,
      replied: false,
      isChatInputCommand: () => true,
      options: { getString: (name: string) => name === "joc" ? gameText : null },
      reply: async (payload: unknown) => { replies.push(payload); return payload; },
      followUp: async (payload: unknown) => { replies.push(payload); return payload; }
    },
    replies
  };
}

function makeFakeCheerioLoad(htmlMarkers: { hasAgeGate?: boolean; dlcRows?: Array<{ name: string; price: string; appId?: string }>; hasPurchaseGame?: boolean }) {
  return (_html: unknown) => {
    return function $(selector: string) {
      if (selector === "#agegate_box" || selector === ".agegate_text_container") {
        return { length: htmlMarkers.hasAgeGate ? 1 : 0 };
      }
      if (selector === ".game_area_purchase_game") {
        return { length: htmlMarkers.hasPurchaseGame ? 1 : 0 };
      }
      if (selector === ".game_area_dlc_row") {
        const rows = htmlMarkers.dlcRows || [];
        return {
          each(cb: (i: number, el: unknown) => void) {
            rows.forEach((row, i) => cb(i, row));
          }
        };
      }
      // selector called on element node
      if (typeof selector === "object" && selector !== null) {
        const el = selector as { name: string; price: string; appId?: string };
        return {
          find(sub: string) {
            if (sub === ".game_area_dlc_name") return { text: () => el.name };
            if (sub === ".game_area_dlc_price") return { text: () => el.price };
            return { text: () => "" };
          },
          attr: (name: string) => name === "data-ds-appid" ? (el.appId || null) : null
        };
      }
      return { length: 0, each: () => undefined };
    };
  };
}

function makeBaseDeps(replies: unknown[], cacheMap: Map<string, any>) {
  return {
    MessageFlags: { Ephemeral: 64 },
    logger: () => undefined,
    enforceCooldown: async () => true,
    startCommandLog: () => () => undefined,
    safeDefer: async () => undefined,
    safeEdit: async (_interaction: unknown, payload: unknown) => { replies.push(payload); return payload; },
    getGuildSettings: async () => ({ currency: "USD" }),
    DEFAULT_CURRENCY: "USD",
    searchSteamGameByName: async () => [{ id: "730", name: "Counter-Strike 2", type: "game" }],
    chooseBestSteamMatch: (items: Array<{ id: string }>) => items[0] || null,
    fetchSteamPriceDetails: async () => ({ header_image: "https://example.test/cs2.jpg" }),
    getCurrencyConfig: () => ({ cc: "US", symbol: "$" }),
    httpReq: async () => ({ data: "<html></html>" }),
    safeCheerioLoad: makeFakeCheerioLoad({ dlcRows: [{ name: "Operation A", price: "$9.99", appId: "1" }] }),
    cache: { dlc: cacheMap },
    cacheGetLRU: (map: Map<string, any>, key: string) => {
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) { map.delete(key); return null; }
      return entry.data;
    },
    cacheSetLRU: (map: Map<string, any>, key: string, data: unknown, ttlMs: number) => {
      map.set(key, { data, expiresAt: Date.now() + ttlMs });
    },
    CACHE_TTL_MS: 60_000,
    DLC_CACHE_MAX_SIZE: 100,
    DLC_ITEMS_PER_PAGE: 10,
    truncate: (s: unknown) => String(s || ""),
    EmbedBuilder: class {
      setColor() { return this; }
      setTitle() { return this; }
      setURL() { return this; }
      setThumbnail() { return this; }
      setDescription() { return this; }
      setFooter() { return this; }
    },
    COLORS: { DLC: 0x9b59b6, ERROR: 0xe74c3c, SUCCESS: 0x57f287, FREE: 0xffd700, INFO: 0x3498db, DARK: 0x2b2d31, POSITIVE: 0x2ecc71 },
    handlePagination: async () => undefined
  };
}

test("dlc handler factory rejects empty gameText BEFORE any cooldown/defer/Steam call", async () => {
  // V11 regression guard: gameText null must short-circuit with an ephemeral
  // reply (interaction.reply, not safeEdit) before consuming cooldown, log,
  // or making any Steam HTTP request.
  const { interaction, replies } = makeDlcInteraction(null);
  const cacheMap = new Map();
  const deps = makeBaseDeps(replies, cacheMap);
  let cooldownCalled = false;
  let searchCalled = false;
  deps.enforceCooldown = async () => { cooldownCalled = true; return true; };
  deps.searchSteamGameByName = async () => { searchCalled = true; return []; };
  const handlers = dlcHandler.createDlcInteractionHandler(deps);

  await handlers.handleDlcInteraction(interaction);

  assert.equal(cooldownCalled, false);
  assert.equal(searchCalled, false);
  assert.equal(replies.length, 1);
  assert.match(String((replies[0] as { content?: string }).content), /Trebuie sa specifici un joc/);
});

test("dlc handler factory reports not-found when Steam search returns empty", async () => {
  const { interaction, replies } = makeDlcInteraction("starcraf");
  const deps = makeBaseDeps(replies, new Map());
  deps.searchSteamGameByName = async () => [];
  const handlers = dlcHandler.createDlcInteractionHandler(deps);

  await handlers.handleDlcInteraction(interaction);

  assert.match(String(replies[replies.length - 1]), /Nu am gasit niciun rezultat pe Steam/);
});

test("dlc handler factory detects age-gate via cheerio selectors", async () => {
  const { interaction, replies } = makeDlcInteraction("nsfw-game");
  const deps = makeBaseDeps(replies, new Map());
  deps.safeCheerioLoad = makeFakeCheerioLoad({ hasAgeGate: true });
  const handlers = dlcHandler.createDlcInteractionHandler(deps);

  await handlers.handleDlcInteraction(interaction);

  assert.match(String(replies[replies.length - 1]), /verificare de varsta/);
});

test("dlc handler factory falls back to schema-drift message when no DLC rows AND no purchase block", async () => {
  // If cheerio finds neither .game_area_dlc_row nor .game_area_purchase_game,
  // the page structure looks invalid → log WARN as schema drift and reply
  // with "Structura paginii ... nu a putut fi interpretata."
  const { interaction, replies } = makeDlcInteraction("cs2");
  const deps = makeBaseDeps(replies, new Map());
  deps.safeCheerioLoad = makeFakeCheerioLoad({ dlcRows: [], hasPurchaseGame: false });
  const handlers = dlcHandler.createDlcInteractionHandler(deps);

  await handlers.handleDlcInteraction(interaction);

  assert.match(String(replies[replies.length - 1]), /Structura paginii.*nu a putut fi interpretata/);
});

test("dlc handler factory reports no-DLC when purchase block exists but rows are empty", async () => {
  const { interaction, replies } = makeDlcInteraction("cs2");
  const deps = makeBaseDeps(replies, new Map());
  deps.safeCheerioLoad = makeFakeCheerioLoad({ dlcRows: [], hasPurchaseGame: true });
  const handlers = dlcHandler.createDlcInteractionHandler(deps);

  await handlers.handleDlcInteraction(interaction);

  assert.match(String(replies[replies.length - 1]), /nu are niciun DLC listat separat/);
});

test("dlc installer intercepts only /dlc and delegates everything else", async () => {
  const { interaction, replies } = makeDlcInteraction("cs2");
  const cacheMap = new Map();
  const deps = makeBaseDeps(replies, cacheMap);
  const delegated: string[] = [];
  const ctx: Record<string, any> = {
    ...deps,
    handleInteraction: async (handled: Record<string, any>) => {
      delegated.push(handled.commandName);
      return "delegated";
    }
  };

  dlcHandler(ctx);
  await ctx.handleInteraction(interaction, []);
  const result = await ctx.handleInteraction({
    commandName: "status",
    guild: { id: "guild-1" },
    isChatInputCommand: () => true,
    options: { getString: () => null },
    reply: async () => undefined
  }, []);

  assert.deepEqual(delegated, ["status"]);
  assert.equal(result, "delegated");
  // Last reply should be the success message from /dlc.
  assert.match(String(replies[replies.length - 1]), /Am gasit \*\*1\*\* DLC-uri/);
});
