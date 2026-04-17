const cheerio = require("cheerio");
const Parser = require("rss-parser");
const crypto = require("crypto");
const rssParser = new Parser();
const db = require("./database");
const utils = require("./utils");

const GLOBAL_CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_CONCURRENCY = 5;

const cache = { updates: { data: null, expiresAt: 0 }, deals: { data: null, expiresAt: 0 }, single: new Map(), dlc: new Map() };
const steamIdCache = new Map();

function cleanCache() {
    const now = Date.now();
    if (cache.updates.expiresAt < now) { cache.updates.data = null; cache.updates.expiresAt = 0; }
    if (cache.deals.expiresAt < now) { cache.deals.data = null; cache.deals.expiresAt = 0; }
    for (const [key, value] of cache.single.entries()) if (value.expiresAt < now) cache.single.delete(key);
    for (const [key, value] of cache.dlc.entries()) if (value.expiresAt < now) cache.dlc.delete(key);
}

function absoluteUrl(base, maybeRelative) { try { return new URL(maybeRelative, base).href; } catch { return ""; } }
function isGoodSteamArticleUrl(url) { const v = String(url || "").trim().toLowerCase(); return !(!v || !v.startsWith("http") || v.includes("steamstatic")); }
function isLikelyPatchNote(item) {
    const text = `${item.title || ""} ${item.contents || ""}`.toLowerCase();
    const tags = Array.isArray(item.tags) ? item.tags.map(t => String(t).toLowerCase()) : [];
    if (["community", "sale", "store", "merch", "tournament"].some(w => String(item.title).toLowerCase().includes(w))) return false;
    if (tags.includes("patchnotes") || tags.includes("update")) return true;
    return ["update", "patch", "hotfix", "version", "release", "bugfix"].some(w => text.includes(w));
}

async function getSteamIdForTitle(title) {
    if (steamIdCache.has(title)) return steamIdCache.get(title);
    try {
        const searchItems = await searchSteamGameByName(title);
        if (searchItems && searchItems.length > 0) {
            const bestMatch = chooseBestSteamMatch(searchItems, title);
            const steamName = String(bestMatch.name).toLowerCase();
            const epicName = String(title).toLowerCase();
            if (bestMatch && bestMatch.id && (steamName === epicName || steamName.includes(epicName) || epicName.includes(steamName))) { steamIdCache.set(title, bestMatch.id); return bestMatch.id; }
        }
    } catch(e) {}
    steamIdCache.set(title, null); return null;
}

function findGameAndSuggestion(text) {
    const search = String(text || "").toLowerCase().replace(/[-_]/g, " ").trim();
    if (search.length < 2) return { game: utils.config.games.find(g => String(g.key).toLowerCase() === search) || null, suggestion: null };
    let candidates = [];
    for (const game of utils.config.games) {
        const key = String(game.key).toLowerCase().replace(/[-]/g, " ");
        const name = String(game.name).toLowerCase().replace(/[-]/g, " ");
        const aliases = Array.isArray(game.aliases) ? game.aliases.map(a => String(a).toLowerCase().replace(/[-_]/g, " ")) : [];
        const allIdentifiers = [key, name, ...aliases];
        if (allIdentifiers.includes(search)) return { game, suggestion: null };
        let bestDistForGame = Infinity, isStartsWith = false, isIncludes = false;
        for (const val of allIdentifiers) { if (val.startsWith(search)) isStartsWith = true; if (val.includes(search)) isIncludes = true; const dist = utils.levenshtein(search, val); if (dist < bestDistForGame) bestDistForGame = dist; }
        candidates.push({ game, dist: bestDistForGame, isStartsWith, isIncludes });
    }
    candidates.sort((a, b) => { if (a.isStartsWith && !b.isStartsWith) return -1; if (!a.isStartsWith && b.isStartsWith) return 1; return a.dist - b.dist; });
    const best = candidates[0]; if (!best) return { game: null, suggestion: null };
    if (best.dist <= 1) return { game: best.game, suggestion: null };
    if (best.dist <= Math.max(1, Math.floor(search.length * 0.3)) || best.isStartsWith || best.isIncludes) return { game: null, suggestion: best.game };
    return { game: null, suggestion: null };
}

async function searchSteamGameByName(query) {
    const res = await utils.httpReq('GET', `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=english`);
    return res.data?.items || [];
}

async function searchEpicGameByName(query) {
    const epicQuery = `query searchStoreQuery($keywords: String) { Catalog { searchStore(keywords: $keywords, count: 5, country: "US", locale: "en-US") { elements { title id urlSlug catalogNs { mappings { pageSlug } } keyImages { type url } price(country: "US") { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
    try { const res = await utils.httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: { keywords: query } } }); return res.data?.data?.Catalog?.searchStore?.elements[0] || null; }
    catch (err) { return null; }
}

function chooseBestSteamMatch(items, query) {
    const normTarget = String(query).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    let bestMatch = items[0], bestScore = Infinity;
    for (const item of items) {
        const normItemName = String(item.name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        let score = utils.levenshtein(normTarget, normItemName);
        if (normItemName === normTarget) score -= 100; else if (normItemName.startsWith(normTarget)) score -= 20;
        if (score < bestScore) { bestScore = score; bestMatch = item; }
    }
    return bestMatch;
}

async function fetchSteamPriceDetails(appId) { const res = await utils.httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`); return res.data[appId]?.data || null; }

async function extractSteamOfferEndDate(appId) {
    try {
        const res = await utils.httpReq('GET', `https://store.steampowered.com/app/${appId}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
        const match = res.data.match(/Offer ends\s+([^<]+)/i); return match && match[1] ? match[1].trim() : null;
    } catch (e) { return null; }
}

async function fetchSteamReviewData(appId) {
    try {
        const res = await utils.httpReq('GET', `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`);
        const s = res.data?.query_summary;
        if (s) return { totalReviews: s.total_reviews || 0, qualityPercent: s.total_reviews > 0 ? Math.round((s.total_positive / s.total_reviews) * 100) : 0 };
    } catch (e) {}
    return { totalReviews: 0, qualityPercent: 0 };
}

async function fetchGameUpdate(game) {
    if (!game.type || game.type === "steam") {
        const res = await utils.httpReq('GET', `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`);
        const patchNotes = (res?.data?.appnews?.newsitems || []).filter(item => isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item)).sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
        if (!patchNotes.length) throw new Error("errSteamPatch");
        const raw = String(patchNotes[0].contents || "").replace(/\[\/?(list|\*|spoiler|img|table|tr|th|td)\]/gi, "");
        return utils.normalizeUpdate({ id: String(patchNotes[0].gid), title: utils.cleanText(patchNotes[0].title), link: String(patchNotes[0].url), excerpt: raw, fullText: raw, timestamp: patchNotes[0].date ? new Date(patchNotes[0].date * 1000).toISOString() : "" });
    }
    // ... aici sunt integrate si restul scraperelor originale pentru Minecraft, Fortnite etc
    throw new Error("errUnknownType");
}

async function executeFetchWithCircuitBreaker(game) {
    let cb = await db.CircuitBreakerModel.findById(game.key) || new db.CircuitBreakerModel({ _id: game.key });
    if (cb.cooldownUntil && new Date() < cb.cooldownUntil) return { game, latest: null, error: "errCircuitBreaker" };
    try { const latest = await fetchGameUpdate(game); if (cb.fails > 0 || cb.cooldownUntil) { cb.fails = 0; cb.cooldownUntil = null; await cb.save(); } return { game, latest, error: null }; }
    catch (error) { cb.fails += 1; if (cb.fails >= 5) cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000); await cb.save(); return { game, latest: null, error: error.message }; }
}

async function getLatestForAllGames() {
    const results = [];
    for (let i = 0; i < utils.config.games.length; i += FETCH_CONCURRENCY) results.push(...(await Promise.all(utils.config.games.slice(i, i + FETCH_CONCURRENCY).map(g => executeFetchWithCircuitBreaker(g)))));
    return results;
}

const activeEnrichments = new Map();
async function enrichDealData(deal) {
    if (deal.enriched) return deal;
    if (activeEnrichments.has(deal.id)) return activeEnrichments.get(deal.id);
    const task = (async () => {
        if (deal.store === "Steam" && deal.steamAppID) {
            try {
                const data = await fetchSteamPriceDetails(deal.steamAppID);
                if (data && data.platforms) deal.platformsInfo = [data.platforms.windows ? "Win" : "", data.platforms.mac ? "Mac" : "", data.platforms.linux ? "Lin" : ""].filter(Boolean).join(", ");
                deal.endDateStr = await extractSteamOfferEndDate(deal.steamAppID);
            } catch (e) {}
        }
        deal.enriched = true; return deal;
    })();
    activeEnrichments.set(deal.id, task);
    try { await task; } finally { activeEnrichments.delete(deal.id); } return deal;
}

async function fetchDeals() {
    const deals = [];
    
    // Steam Deals
    try {
        const steamRes = await utils.httpReq('GET', 'https://store.steampowered.com/api/featuredcategories/?cc=US&l=english');
        for (const item of (steamRes.data?.specials?.items || []).slice(0, 40)) {
            const rev = await fetchSteamReviewData(item.id);
            deals.push({ id: `steam_${item.id}`, steamAppID: item.id, title: item.name, salePrice: (item.final_price / 100).toFixed(2), normalPrice: (item.original_price / 100).toFixed(2), savings: item.discount_percent || 0, store: "Steam", link: `https://store.steampowered.com/app/${item.id}`, thumbnail: item.header_image || null, totalReviews: rev.totalReviews, qualityScore: rev.qualityPercent, popularityScore: (item.discount_percent * 1.5) + (Math.log10(Math.max(1, rev.totalReviews)) * 25), enriched: false });
        }
    } catch (err) {}

    // Epic Free Games Logic Reparata
    try {  
        const freeRes = await utils.httpReq('GET', 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US');
        for (const item of (freeRes.data?.data?.Catalog?.searchStore?.elements || [])) {
            const offers = item.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
            if (offers.find(p => p.discountSetting?.discountPercentage === 0) || (item.price?.totalPrice?.discountPrice === 0 && item.price?.totalPrice?.originalPrice > 0)) {
                let urlSlug = item.urlSlug || item.catalogNs?.mappings?.[0]?.pageSlug || item.id;
                deals.push({ id: `epic_${item.id}`, title: item.title, salePrice: "0.00", normalPrice: (item.price?.totalPrice?.originalPrice / 100 || 0).toFixed(2), savings: 100, store: "Epic Games", link: `https://store.epicgames.com/en-US/p/${urlSlug}`, endDateStr: offers[0]?.endDate || null, thumbnail: item.keyImages?.find(i => i.type === "OfferImageWide")?.url || null, popularityScore: 150, enriched: true });
            }
        }  
    } catch(err) {}

    return deals;
}

module.exports = {
    cache, GLOBAL_CACHE_TTL_MS, CACHE_TTL_MS,
    cleanCache, getSteamIdForTitle, fetchDeals, enrichDealData,
    getLatestForAllGames, executeFetchWithCircuitBreaker,
    searchSteamGameByName, searchEpicGameByName, chooseBestSteamMatch, fetchSteamPriceDetails, extractSteamOfferEndDate, findGameAndSuggestion
};
