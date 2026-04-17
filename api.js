const cheerio = require("cheerio");
const Parser = require("rss-parser");
const rssParser = new Parser();

const db = require("./database");
const utils = require("./utils");

const cache = {
    updates: { data: null, expiresAt: 0 },
    deals: { data: null, expiresAt: 0 },
    single: new Map(),
    dlc: new Map()
};

const steamIdCache = new Map();

function cleanCache() {
    const now = Date.now();
    if (cache.updates.expiresAt < now) { cache.updates.data = null; cache.updates.expiresAt = 0; }
    if (cache.deals.expiresAt < now) { cache.deals.data = null; cache.deals.expiresAt = 0; }
    for (const [key, value] of cache.single.entries()) { if (value.expiresAt < now) cache.single.delete(key); }
    for (const [key, value] of cache.dlc.entries()) { if (value.expiresAt < now) cache.dlc.delete(key); }
    if (cache.dlc.size > 100) { const oldestKeys = [...cache.dlc.keys()].slice(0, 20); oldestKeys.forEach(k => cache.dlc.delete(k)); }
    if (cache.single.size > 100) { const oldestKeys = [...cache.single.keys()].slice(0, 20); oldestKeys.forEach(k => cache.single.delete(k)); }
    if (steamIdCache.size > 500) {
        const firstKey = steamIdCache.keys().next().value;
        steamIdCache.delete(firstKey);
    }
}

async function getSteamIdForTitle(title) {
    if (steamIdCache.has(title)) {
        const val = steamIdCache.get(title);
        steamIdCache.delete(title);
        steamIdCache.set(title, val);
        return val;
    }
    try {
        const searchItems = await searchSteamGameByName(title);
        if (searchItems && searchItems.length > 0) {
            const bestMatch = chooseBestSteamMatch(searchItems, title);
            const steamName = String(bestMatch.name).toLowerCase();
            const epicName = String(title).toLowerCase();
            if (bestMatch && bestMatch.id && (steamName === epicName || steamName.includes(epicName) || epicName.includes(steamName))) {  
                steamIdCache.set(title, bestMatch.id);
                return bestMatch.id;  
            }  
        }
    } catch(e) {}
    steamIdCache.set(title, null);
    return null;
}

// -------------------------------------------------------------
// HELPERE CĂUTARE ȘI MATCHING
// -------------------------------------------------------------
async function searchSteamGameByName(query) {
    const searchRes = await utils.httpReq('GET', `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=US&l=english`);
    return searchRes.data?.items || [];
}

async function searchEpicGameByName(query) {
    const epicQuery = `query searchStoreQuery($keywords: String, $count: Int, $country: String!, $locale: String, $withPrice: Boolean = false) { Catalog { searchStore(keywords: $keywords, count: $count, country: $country, locale: $locale) { elements { title id urlSlug catalogNs { mappings { pageSlug } } keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
    const epicVars = { keywords: query, count: 5, country: "US", locale: "en-US", withPrice: true };
    try {
        const res = await utils.httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: epicVars } });
        const elements = res.data?.data?.Catalog?.searchStore?.elements || [];
        if (!elements.length) return null;
        return chooseBestEpicMatch(elements, query);
    } catch (err) {
        utils.logger("WARN", "EPIC_SEARCH", "Epic GraphQL search failed", err.message);
        return null;
    }
}

function chooseBestEpicMatch(items, query) {
    const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const normTarget = normalize(query);
    let bestMatch = items[0];
    let bestScore = Infinity;
    for (const item of items) {
        const normItemName = normalize(item.title);
        let score = utils.levenshtein(normTarget, normItemName);
        if (normItemName === normTarget) score -= 100;
        else if (normItemName.startsWith(normTarget)) score -= 20;
        else if (normItemName.includes(normTarget)) score -= 10;
        if (score < bestScore) { bestScore = score; bestMatch = item; }
    }
    return bestMatch;
}

function chooseBestSteamMatch(items, query) {
    const normalize = (str) => String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const searchTarget = query.toLowerCase().trim();
    const normTarget = normalize(query);
    const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
    const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));
    const extraTypes = new Set(["dlc", "demo", "music"]);

    let bestMatch = items[0];
    let bestScore = Infinity;

    for (const item of items) {
        const itemName = String(item.name || "").toLowerCase();
        const normItemName = normalize(itemName);
        let score = utils.levenshtein(normTarget, normItemName);

        if (normItemName === normTarget) score -= 100;  
        else if (normItemName.startsWith(normTarget)) score -= 20;
        else if (normItemName.includes(normTarget)) score -= 10;  

        if (!wantsDLC) {  
            const isExtraByName = dlcKeywords.some(kw => itemName.includes(kw));
            const isExtraByType = typeof item.type === "string" && extraTypes.has(item.type.toLowerCase());  
            if (isExtraByName || isExtraByType) score += 50;
        }  
        if (score < bestScore) { bestScore = score; bestMatch = item; }
    }
    return bestMatch;
}

async function fetchSteamPriceDetails(appId) {
    const detailsRes = await utils.httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=US&l=english`);
    return detailsRes.data[appId]?.data || null;
}

async function extractSteamOfferEndDate(appId) {
    try {
        const htmlRes = await utils.httpReq('GET', `https://store.steampowered.com/app/${appId}`, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
        const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
        return match && match[1] ? match[1].trim() : null;
    } catch (err) {
        utils.logger("WARN", "STEAM_OFFER_DATE", "Failed to extract offer end date", err.message);
        return null;
    }
}

async function fetchSteamReviewData(appId) {
    try {
        const res = await utils.httpReq('GET', `https://store.steampowered.com/appreviews/${appId}?json=1&language=all&num_per_page=0`);
        const summary = res.data?.query_summary;
        if (summary) {
            const totalReviews = summary.total_reviews || 0;
            const positiveReviews = summary.total_positive || 0;
            const qualityPercent = totalReviews > 0 ? Math.round((positiveReviews / totalReviews) * 100) : 0;
            return { totalReviews, qualityPercent };
        }
    } catch (err) {
        utils.logger("WARN", "STEAM_REVIEW", "Failed to fetch review data", err.message);
    }
    return { totalReviews: 0, qualityPercent: 0 };
}

// -------------------------------------------------------------
// SCRAPERS PENTRU UPDATE-URI (TOATE PLATFORMELE)
// -------------------------------------------------------------
function absoluteUrl(base, maybeRelative) { try { return new URL(maybeRelative, base).href; } catch { return ""; } }
function isGoodSteamArticleUrl(url) { const v = String(url || "").trim().toLowerCase(); return !(!v || !v.startsWith("http") || v.includes("steamstatic") || v.includes("steamcdn")); }
function extractDateScore(url) { const u = url.toLowerCase(); const m1 = u.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/); if (m1) { const d = new Date(`${m1[1]}-${m1[2]}-${m1[3]}`); if (!isNaN(d.getTime())) return d.getTime(); } return 0; }
function scoreCandidate(candidate, keywords) { const haystack = `${candidate.href} ${candidate.text}`.toLowerCase(); let score = 0; for (const k of keywords) if (haystack.includes(String(k).toLowerCase())) score += 1; return score; }

function isLikelyPatchNote(item) {
    const title = String(item.title || "").toLowerCase();
    const contents = String(item.contents || "").toLowerCase();
    const tags = Array.isArray(item.tags) ? item.tags.map((t) => String(t).toLowerCase()) : [];
    const text = `${title} ${contents}`;

    const badWordsInTitle = ["community", "sale", "store", "merch", "tournament", "esports", "giveaway", "teaser", "trailer", "preview", "announce", "announcement"];
    if (badWordsInTitle.some((word) => title.includes(word))) return false;

    if (tags.includes("patchnotes") || tags.includes("update")) return true;
    const goodWords = ["update", "patch", "hotfix", "version", "release", "bugfix", "bug fix", "fixes", "fix", "notes", "patch notes", "changelog", "maintenance", "build", "client update", "title update", "release notes", "season", "chapter", "rework", "balance", "content update", "launch"];
    return goodWords.some((word) => text.includes(word));
}

async function fetchSteamUpdate(game) {
    const response = await utils.httpReq('GET', `https://api.steampowered.com/ISteamNews/GetNewsForApp/v0002/?appid=${game.appId}&count=50&format=json`);
    const patchNotes = (response?.data?.appnews?.newsitems || [])
        .filter(item => (item.feed_type === 1 || item.feedname === "steam_community_announcements") && isGoodSteamArticleUrl(item.url) && isLikelyPatchNote(item))
        .sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    if (!patchNotes.length) throw new Error("errSteamPatch");
    const latest = patchNotes[0];

    const rawContents = String(latest.contents || "").replace(/\[\/?(list|\*|spoiler|img|table|tr|th|td)\]/gi, "");
    return utils.normalizeUpdate({ id: String(latest.gid), title: utils.cleanText(latest.title), link: String(latest.url), excerpt: rawContents, fullText: rawContents, timestamp: latest.date ? new Date(latest.date * 1000).toISOString() : "" });
}

async function fetchListingBasedUpdate(game) {
    const listingUrls = Array.isArray(game.listingUrls) && game.listingUrls.length ? game.listingUrls : [game.listingUrl];
    const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
    const hrefRegex = game.articleHrefRegex ? new RegExp(game.articleHrefRegex, "i") : null;
    let collected = [];
    for (const url of listingUrls) {
        try {
            const listRes = await utils.httpReq('GET', url);
            const $ = cheerio.load(String(listRes.data));
            let position = 0;
            $('a').each((i, el) => {
                const href = absoluteUrl(game.baseUrl, $(el).attr('href'));
                if (!href || (hrefRegex && !hrefRegex.test(href))) return;
                const candidate = { href, text: utils.cleanText($(el).text()), position: position++ };
                if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
                collected.push(candidate);
            });
        } catch (err) { utils.logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, err.message); }
    }

    const seen = new Set();
    const unique = collected.filter(item => { if (!item.href || seen.has(item.href)) return false; seen.add(item.href); return true; });
    unique.sort((a, b) => {
        if (keywords.length) { const s = scoreCandidate(b, keywords) - scoreCandidate(a, keywords); if(s!==0) return s; }
        const d = extractDateScore(b.href) - extractDateScore(a.href); if(d!==0) return d;
        return a.position - b.position;
    });
    if (!unique.length) throw new Error("errAncore");

    const articleUrl = unique[0].href;
    const articleRes = await utils.httpReq('GET', articleUrl);
    const $art = cheerio.load(String(articleRes.data || ""));

    const ogTitle = $art('meta[property="og:title"]').attr('content') || $art('title').text() || "";
    const ogDesc = $art('meta[property="og:description"]').attr('content') || "";
    $art('script, style, nav, footer, header').remove();
    const rawContent = $art('article').text() || $art('main').text() || $art('body').text();
    return utils.normalizeUpdate({ id: String(articleUrl), title: utils.cleanText(ogTitle) || `${game.name} Update`, link: articleUrl, excerpt: utils.cleanText(ogDesc), fullText: utils.cleanText(rawContent), thumbnail: game.thumbnail });
}

async function fetchFortniteUpdate() {
    try {
        const posts = JSON.parse(await utils.fetchWithProxy("https://www.fortnite.com/api/blog/getPosts?postsPerPage=10&offset=0&locale=en-US", { timeout: 15000 }) || "{}")?.blogList;
        const valid = (posts || []).filter(p => p.slug && p.slug.toLowerCase() !== "news");
        if (!valid.length) throw new Error("errFortnite");
        const latest = valid.find(p => /update|patch|\bv\d+/i.test(String(p.title))) || valid[0];  
        return utils.normalizeUpdate({ id: String(latest.slug), title: utils.cleanText(latest.title), link: `https://www.fortnite.com/news/${latest.slug}`, excerpt: utils.cleanText(latest.shareDescription), excerptKey: "excerptFortnite", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: latest.date });
    } catch (err) {
        const backupUrl = "https://news.google.com/rss/search?q=site:fortnite.com/news+update&hl=en-US";
        const feed = await rssParser.parseString((await utils.httpReq('GET', backupUrl)).data);
        if (!feed.items || feed.items.length === 0) throw new Error("errFortniteTotal");
        return utils.normalizeUpdate({ id: feed.items[0].link, title: utils.cleanText(feed.items[0].title), link: feed.items[0].link, excerpt: "Update oficial Fortnite.", excerptKey: "excerptFortnite", thumbnail: "https://seeklogo.com/images/F/fortnite-logo-4C22EED4A9-seeklogo.com.png", timestamp: feed.items[0].pubDate });
    }
}

async function fetchAmdUpdate(game) {
    try {
        const rawContent = await utils.fetchWithProxy("https://www.amd.com/en/support/download/drivers.html");
        const match = rawContent.match(/Adrenalin Edition\s+([\d.]+)/i);
        if (match) return utils.normalizeUpdate({ id: match[1], title: `AMD Radeon Adrenalin v${match[1]}`, link: "https://www.amd.com", excerpt: "Driver disponibil.", excerptKey: "excerptAmdDriver", thumbnail: game.thumbnail });
    } catch (err) {
        utils.logger("WARN", "AMD_UPDATE", "Failed proxy fetch", err.message);
    }
    const res = await utils.httpReq('GET', `https://news.google.com/rss/search?q=site:amd.com+%22AMD+Software:+Adrenalin+Edition%22+release+notes&hl=en-US`);
    const feed = await rssParser.parseString(res.data);
    if (!feed.items || feed.items.length === 0) throw new Error("errAMD");
    return utils.normalizeUpdate({ id: utils.cleanText(feed.items[0].title), title: utils.cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update AMD.com.", excerptKey: "excerptAMD", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchIntelUpdate(game) {
    try {
        const rawContent = await utils.fetchWithProxy(game.url);
        const match = rawContent.match(/\b(\d{2,3}\.\d+\.\d+\.\d+)\b/);
        if (match) return utils.normalizeUpdate({ id: match[1], title: `${game.name} v${match[1]}`, link: game.url, excerpt: `Versiune găsită: ${match[1]}`, excerptKey: "excerptVersion", excerptParams: { v: match[1] }, thumbnail: game.thumbnail });
    } catch (err) {
        utils.logger("WARN", "INTEL_UPDATE", "Failed proxy fetch", err.message);
    }
    const q = game.key === "intelpro" ? 'site:intel.com "Intel Arc Pro Graphics"' : 'site:intel.com "Intel Arc & Iris Xe Graphics - Windows"';
    const res = await utils.httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US`);
    const feed = await rssParser.parseString(res.data);
    if (!feed.items || feed.items.length === 0) throw new Error("errIntel");
    return utils.normalizeUpdate({ id: utils.cleanText(feed.items[0].title), title: utils.cleanText(feed.items[0].title).split(" - ")[0], link: feed.items[0].link, excerpt: "Update intel.com detectat.", excerptKey: "excerptIntel", thumbnail: game.thumbnail, timestamp: feed.items[0].pubDate });
}

async function fetchMinecraftUpdate() {
    try {
        const r = await utils.httpReq('GET', "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
        const v = r?.data?.latest?.release;
        if(!v) throw new Error("errMinecraft");
        return utils.normalizeUpdate({ id: v, title: `Minecraft ${v}`, link: `https://www.minecraft.net/en-us/article/minecraft-java-edition-${v.replace(/\./g, "-")}`, excerpt: `Versiunea ${v}`, excerptKey: "excerptVersion", excerptParams: { v: v }, thumbnail: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c7/Grass_Block_Revision_6.png" });
    } catch (err) {
        utils.logger("WARN", "MINECRAFT", "Failed to fetch update", err.message);
        throw err;
    }
}

async function fetchRobloxUpdate() {
    try {
        const r = await utils.httpReq('GET', "https://clientsettings.roblox.com/v2/client-version/WindowsPlayer");
        const v = r?.data?.clientVersionUpload;
        if(!v) throw new Error("errRoblox");
        return utils.normalizeUpdate({ id: String(v), title: "Roblox Update", link: "https://en.help.roblox.com/hc/en-us", excerpt: `Versiunea ${v}`, excerptKey: "excerptVersion", excerptParams: { v: String(v) }, thumbnail: "https://upload.wikimedia.org/wikipedia/commons/7/7e/Roblox_Logo_2022.jpg" });
    } catch (err) {
        utils.logger("WARN", "ROBLOX", "Failed to fetch update", err.message);
        throw err;
    }
}

async function fetchNvidiaUpdate(g) {
    try {
        const q = g.key === "nvidiastudio" ? '"Studio Driver"' : '"Game Ready Driver"';
        const r = await utils.httpReq('GET', `https://news.google.com/rss/search?q=${encodeURIComponent("site:nvidia.com " + q + " release")}&hl=en-US`);
        const f = await rssParser.parseString(r.data);
        if (!f.items || f.items.length === 0) throw new Error("errNvidia");
        return utils.normalizeUpdate({ id: f.items[0].link, title: utils.cleanText(f.items[0].title).split(" - ")[0], link: f.items[0].link, thumbnail: g.thumbnail });
    } catch (err) {
        utils.logger("WARN", "NVIDIA", "Failed to fetch update", err.message);
        throw err;
    }
}

async function fetchGameUpdate(game) {
    const t = game.type;
    if (!t || t === "steam") return await fetchSteamUpdate(game);
    if (t === "minecraft") return await fetchMinecraftUpdate();
    if (t === "epic_games" && game.key === "fortnite") return await fetchFortniteUpdate();
    if (t === "roblox") return await fetchRobloxUpdate();
    if (t === "nvidia") return await fetchNvidiaUpdate(game);
    if (t === "intel") return await fetchIntelUpdate(game);
    if (t === "amd") return await fetchAmdUpdate(game);
    if (t === "listing_based" || t === "epic_games") return await fetchListingBasedUpdate(game);
    throw new Error("errUnknownType");
}

async function executeFetchWithCircuitBreaker(game) {
    let cb = await db.CircuitBreakerModel.findById(game.key);
    if (!cb) cb = new db.CircuitBreakerModel({ _id: game.key });
    if (cb.cooldownUntil && new Date() < cb.cooldownUntil) return { game, latest: null, error: "errCircuitBreaker" };
    try {
        const latest = await fetchGameUpdate(game);
        if (cb.fails > 0 || cb.cooldownUntil) { cb.fails = 0; cb.cooldownUntil = null; await cb.save(); }
        return { game, latest, error: null };
    } catch (error) {
        cb.fails += 1;
        if (cb.fails >= 5) cb.cooldownUntil = new Date(Date.now() + 45 * 60 * 1000);
        await cb.save();
        return { game, latest: null, error: error.message };
    }
}

async function getLatestForAllGames() {
    const results = [];
    for (let i = 0; i < utils.config.games.length; i += utils.FETCH_CONCURRENCY) {
        const chunk = utils.config.games.slice(i, i + utils.FETCH_CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(async (game) => await executeFetchWithCircuitBreaker(game)));
        results.push(...chunkResults);
    }
    return results;
}

const activeEnrichments = new Map();

async function enrichDealData(deal) {
    if (deal.enriched) return deal;
    if (activeEnrichments.has(deal.id)) return activeEnrichments.get(deal.id);
    const enrichTask = (async () => {
        if (deal.store === "Steam" && deal.steamAppID) {
            try {
                const res = await utils.httpReq('GET', `https://store.steampowered.com/api/appdetails?appids=${deal.steamAppID}&cc=US&l=english`, { timeout: 5000 });
                const data = res.data[deal.steamAppID]?.data;
                if (data && data.platforms) {
                    deal.platformsInfo = [
                        data.platforms.windows ? "Win" : "",
                        data.platforms.mac ? "Mac" : "",
                        data.platforms.linux ? "Lin" : ""
                    ].filter(Boolean).join(", ");
                }
                const htmlRes = await utils.httpReq('GET', deal.link, { headers: { "Cookie": "birthtime=283993201; mature_content=1;" } });
                const match = htmlRes.data.match(/Offer ends\s+([^<]+)/i);
                if (match && match[1]) deal.endDateStr = match[1].trim();
            } catch (e) {
                utils.logger("WARN", "STEAM_ENRICH", "Failed to enrich deal data", e.message);
            }
        }
        deal.enriched = true;
        return deal;
    })();
    activeEnrichments.set(deal.id, enrichTask);
    try { await enrichTask; } finally { activeEnrichments.delete(deal.id); }
    return deal;
}

// -------------------------------------------------------------
// FETCH DEALS COMPUS (STEAM + EPIC GAMES ROBUST)
// -------------------------------------------------------------
async function fetchDeals() {
    const deals = [];
    const steamDealsTemp = [];

    // 1. STEAM DEALS - Featured Specials
    try {
        const steamRes = await utils.httpReq('GET', 'https://store.steampowered.com/api/featuredcategories/?cc=US&l=english');
        const steamSpecials = (steamRes.data?.specials?.items || []).slice(0, 40);

        for (const item of steamSpecials) {  
            steamDealsTemp.push({  
                id: `steam_${item.id}`, steamAppID: item.id, title: item.name,   
                salePrice: (item.final_price / 100).toFixed(2), normalPrice: (item.original_price / 100).toFixed(2),   
                savings: item.discount_percent || 0, store: "Steam", link: `https://store.steampowered.com/app/${item.id}`,   
                thumbnail: item.header_image || null, isFreebie: false  
            });
        }
    } catch (err) { utils.logger("WARN", "DEALS_FETCH", "Eroare Steam API", err.message); }

    // 1.5 STEAM DEALS - Scraper avansat pentru promotii 100% Free
    try {
        const searchRes = await utils.httpReq('GET', 'https://store.steampowered.com/search/results/?query&start=0&count=50&dynamic_data=&sort_by=Price_ASC&snr=1_7_7_7000_7&specials=1&infinite=1');
        if (searchRes.data && searchRes.data.results_html) {
            const $ = cheerio.load(searchRes.data.results_html);
            $('a.search_result_row').each((i, el) => {
                // Modificat aici: prindem mai multe clase Steam posibile și relaxăm condiția
                const discountText = $(el).find('.search_discount span, .discount_pct').text().trim();
                
                if (discountText.includes('100%')) {
                    const appId = $(el).attr('data-ds-appid');
                    const title = $(el).find('.title').text().trim();
                    let normalPrice = $(el).find('strike, .discount_original_price').text().trim().replace(/[^0-9.]/g, '');
                    if (!normalPrice) normalPrice = "0.00";

                    if (!steamDealsTemp.some(d => d.steamAppID == appId)) {  
                        steamDealsTemp.push({  
                            id: `steam_${appId}`, steamAppID: appId, title: title,   
                            salePrice: "0.00", normalPrice: normalPrice,   
                            savings: 100, store: "Steam", link: `https://store.steampowered.com/app/${appId}`,   
                            thumbnail: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`, isFreebie: true  
                        });  
                    }  
                }  
            });
        }
    } catch (err) { utils.logger("WARN", "STEAM_FREE_SCRAPE", "Eroare la scrape pentru freebies pe Steam", err.message); }

    const steamReviewsData = [];
    for (let i = 0; i < steamDealsTemp.length; i += 5) {
        const chunk = steamDealsTemp.slice(i, i + 5);
        const chunkPromises = chunk.map(item => fetchSteamReviewData(item.steamAppID));
        steamReviewsData.push(...(await Promise.all(chunkPromises)));
        await new Promise(res => setTimeout(res, 500));
    }

    for (let i = 0; i < steamDealsTemp.length; i++) {
        const item = steamDealsTemp[i];
        const revData = steamReviewsData[i];
        let reviewVolumeScore = Math.log10(Math.max(1, revData.totalReviews)) * 25;   
        let qualityMultiplier = revData.qualityPercent / 100;  

        let newGameBoost = 0;
        if (item.steamAppID && parseInt(item.steamAppID) > 2000000 && revData.totalReviews < 1000) {  
            newGameBoost = 40;
        }  

        let lowReviewPenalty = revData.totalReviews < 50 ? -100 : 0;
        let hybridScore = (item.savings * 1.5) + (reviewVolumeScore * qualityMultiplier) + newGameBoost + lowReviewPenalty;
        
        if (item.isFreebie) {  
            hybridScore = Math.max(hybridScore, 100 + (parseFloat(item.normalPrice) || 0));
        }  

        item.popularityScore = hybridScore;  
        item.totalReviews = revData.totalReviews;  
        item.qualityScore = revData.qualityPercent;  
        item.endDateStr = null;  
        item.extraDetails = item.isFreebie ? "\n*(Promoție 100% detectată de bot)*" : "";  
        item.platformsInfo = null;  
        item.enriched = false;  

        delete item.isFreebie;  
        deals.push(item);
    }

    // 2. EPIC GAMES DEALS 
    const epicDealsTemp = [];
    try {
        // Categoria a fost setată corect la "games/edition/base" pentru a funcționa
        const epicQuery = `query searchStoreQuery($category: String, $count: Int, $country: String!, $locale: String, $onSale: Boolean, $withPrice: Boolean = false) { Catalog { searchStore(category: $category, count: $count, country: $country, locale: $locale, onSale: $onSale) { elements { title id urlSlug catalogNs { mappings { pageSlug } } keyImages { type url } price(country: $country) @include(if: $withPrice) { totalPrice { discountPrice originalPrice } } promotions { promotionalOffers { promotionalOffers { endDate discountSetting { discountPercentage } } } } } } } }`;
        const epicVars = { category: "games/edition/base", count: 40, country: "US", locale: "en-US", onSale: true, withPrice: true };
        const epicRes = await utils.httpReq('POST', 'https://graphql.epicgames.com/graphql', { data: { query: epicQuery, variables: epicVars } });
        const epicElements = epicRes.data?.data?.Catalog?.searchStore?.elements || [];

        for (const item of epicElements) {  
            const priceInfo = item.price?.totalPrice;  
            if (!priceInfo) continue;
            const normalPriceNum = priceInfo.originalPrice / 100;  
            const normalPrice = normalPriceNum.toFixed(2);  
            const salePrice = (priceInfo.discountPrice / 100).toFixed(2);  

            let savings = 0;
            if (priceInfo.originalPrice > 0) savings = Math.round(((priceInfo.originalPrice - priceInfo.discountPrice) / priceInfo.originalPrice) * 100);  

            let thumb = null;
            if (Array.isArray(item.keyImages)) {  
                const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
                if (img) thumb = img.url;  
            }  

            let endDate = null;  
            const promos = item.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
            if (promos && promos.endDate) endDate = promos.endDate;  

            let urlSlug = item.urlSlug || item.id;
            if (!item.urlSlug && item.catalogNs && item.catalogNs.mappings && item.catalogNs.mappings.length > 0) {  
                urlSlug = item.catalogNs.mappings[0].pageSlug;
            }  

            epicDealsTemp.push({  
                id: `epic_${item.id}`, steamAppID: null, title: item.title, salePrice: salePrice, normalPrice: normalPrice, normalPriceNum: normalPriceNum, savings: savings, store: "Epic Games", link: `https://store.epicgames.com/en-US/p/${urlSlug}`, endDateStr: endDate, platformsInfo: null, enriched: true, thumbnail: thumb   
            });
        }
    } catch (err) { 
        utils.logger("WARN", "DEALS_FETCH", "Eroare Epic GraphQL (Deals)", err.message); 
    }

    // 3. EPIC FREE GAMES ROBUST FETCH
    try {  
        const freeRes = await utils.httpReq('GET', 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US');
        const freeElements = freeRes.data?.data?.Catalog?.searchStore?.elements || [];  

        for (const item of freeElements) {
            const activeOffers = item.promotions?.promotionalOffers?.[0]?.promotionalOffers || [];
            const activeFreeOffer = activeOffers.find(p => p.discountSetting?.discountPercentage === 0);
            
            const isFreeNow = activeFreeOffer || (item.price?.totalPrice?.discountPrice === 0 && item.price?.totalPrice?.originalPrice > 0);

            if (isFreeNow) {
                let thumb = null;
                if (Array.isArray(item.keyImages)) {
                    const img = item.keyImages.find(i => i.type === "OfferImageWide" || i.type === "Thumbnail");
                    if (img) thumb = img.url;
                }
                let urlSlug = item.urlSlug || item.catalogNs?.mappings?.[0]?.pageSlug || item.id;

                const existing = epicDealsTemp.find(d => d.id === `epic_${item.id}`);
                if (!existing) {
                    epicDealsTemp.push({
                        id: `epic_${item.id}`, steamAppID: null, title: item.title, salePrice: "0.00",
                        normalPrice: (item.price?.totalPrice?.originalPrice / 100 || 0).toFixed(2), normalPriceNum: (item.price?.totalPrice?.originalPrice || 0) / 100, savings: 100,
                        store: "Epic Games", link: `https://store.epicgames.com/en-US/p/${urlSlug}`,
                        endDateStr: activeFreeOffer?.endDate || null, platformsInfo: null, enriched: true, thumbnail: thumb
                    });
                } else {
                    existing.salePrice = "0.00";
                    existing.savings = 100;
                    if(activeFreeOffer?.endDate) existing.endDateStr = activeFreeOffer.endDate;
                }
            }
        }  
    } catch(err) {  
        utils.logger("WARN", "EPIC_FREE", "Eroare Epic Free Games", err.message);
    }  

    // 4. CROSS-PLATFORM SCORING
    try {
        const epicReviewsData = [];
        for (let i = 0; i < epicDealsTemp.length; i += 5) {  
            const chunk = epicDealsTemp.slice(i, i + 5);
            const chunkPromises = chunk.map(async (deal) => {  
                const steamId = await getSteamIdForTitle(deal.title);  
                if (steamId) return await fetchSteamReviewData(steamId);  
                return null;  
            });
            epicReviewsData.push(...(await Promise.all(chunkPromises)));  
            await new Promise(res => setTimeout(res, 500));   
        }  

        for (let i = 0; i < epicDealsTemp.length; i++) {  
            const deal = epicDealsTemp[i];
            const revData = epicReviewsData[i];  

            if (revData && revData.totalReviews > 0) {  
                let reviewVolumeScore = Math.log10(Math.max(1, revData.totalReviews)) * 25;
                let qualityMultiplier = revData.qualityPercent / 100;  
                let lowReviewPenalty = revData.totalReviews < 50 ? -100 : 0;
                deal.popularityScore = (deal.savings * 1.5) + (reviewVolumeScore * qualityMultiplier) + lowReviewPenalty;  
                deal.qualityScore = revData.qualityPercent;  
                deal.totalReviews = revData.totalReviews;
                deal.extraDetails = "\n*(Scor comunitar preluat via Steam)*";  
            } else {  
                deal.popularityScore = deal.savings + Math.min(20, deal.normalPriceNum / 2);
                deal.qualityScore = 0;  
                deal.totalReviews = 0;  
                deal.extraDetails = "\n*(Exclusiv Epic/Fără recenzii publice)*";  
            }  
            deals.push(deal);
        }
    } catch (err) {
        utils.logger("WARN", "EPIC_SCORING", "Eroare la calcularea scorului Epic", err.message);
    }

    return deals;
}

module.exports = {
    cache,
    cleanCache,
    searchSteamGameByName,
    searchEpicGameByName,
    chooseBestSteamMatch,
    fetchSteamPriceDetails,
    extractSteamOfferEndDate,
    getLatestForAllGames,
    executeFetchWithCircuitBreaker,
    fetchDeals,
    enrichDealData
};
