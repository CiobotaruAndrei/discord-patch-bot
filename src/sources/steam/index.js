"use strict";

module.exports = (ctx) => {
  const { logger, getCurrencyConfig, httpReq, safeCheerioLoad } = ctx;

async function searchSteamGameByName(query, currencyCode) {
  const cc = getCurrencyConfig(currencyCode).cc;
  const searchRes = await httpReq("GET",
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=${cc}&l=english`,
    { largeJson: true });
  return searchRes.data?.items || [];
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function chooseBestSteamMatch(items, query, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const { forceGameOnly = false } = options;
  const normalize = (str) => String(str).toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const searchTarget = query.toLowerCase().trim();
  const normTarget = normalize(query);
  const dlcKeywords = ["dlc", "soundtrack", "demo", "expansion", "deluxe upgrade", "season pass", "ost", "artbook", "collection", "remaster", "bundle", "definitive edition"];
  const wantsDLC = dlcKeywords.some(kw => searchTarget.includes(kw));
  const extraTypes = new Set(["dlc", "demo", "music"]);

  let pool = items;
  if (forceGameOnly && !wantsDLC) {
    const gamesOnly = items.filter(item => {
      const type = String(item.type || "").toLowerCase();
      const nameHasExtra = dlcKeywords.some(kw => String(item.name || "").toLowerCase().includes(kw));
      if (type && type !== "game") return false;
      if (nameHasExtra) return false;
      return true;
    });
    if (gamesOnly.length > 0) pool = gamesOnly;
  }

  if (!pool.length) return null;

  let bestMatch = pool[0];
  let bestScore = Infinity;
  for (const item of pool) {
    const itemName = String(item.name || "").toLowerCase();
    const normItemName = normalize(itemName);
    let score = levenshtein(normTarget, normItemName);

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

async function fetchSteamPriceDetails(appId, currencyCode) {
  const cc = getCurrencyConfig(currencyCode).cc;
  const detailsRes = await httpReq("GET",
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&l=english`,
    { largeJson: true });
  return detailsRes.data[appId]?.data || null;
}

function extractOfferEndFromHtml(html) {
  try {
    const $ = safeCheerioLoad(html);
    const cdText = $(".game_purchase_discount_countdown").first().text().trim();
    if (cdText) {
      const match = cdText.match(/(?:Offer|Sale|Special\s+promotion)\s+ends\s+([^<\n]+)/i)
        || cdText.match(/Daily\s+Deal!?\s*Offer\s+ends\s+([^<\n]+)/i);
      if (match && match[1]) return match[1].trim().slice(0, 200).replace(/\s{2,}/g, " ");
    }

    const bodyText = $("body").text();
    const candidates = [
      /Offer ends\s+([^<\n]+)/i,
      /Sale ends\s+([^<\n]+)/i,
      /Special promotion ends\s+([^<\n]+)/i,
      /Daily Deal!?\s*Offer ends\s+([^<\n]+)/i
    ];
    for (const re of candidates) {
      const match = bodyText.match(re);
      if (match && match[1]) return match[1].trim().slice(0, 200).replace(/\s{2,}/g, " ");
    }
  } catch {
    // Fallback to raw HTML regex below.
  }

  const rawMatch = String(html || "").match(/Offer ends\s+([^<\n]+)/i);
  return rawMatch && rawMatch[1] ? rawMatch[1].trim().slice(0, 200) : null;
}

// V9: primește currency-ul pentru a cere pagina HTML în regiunea corectă.
// Steam returnează formatul "Offer ends ..." în limba/regiunea cerută, deci fără
// cc=RO un guild pe RON parsa rezultatul englez în locul celui așteptat.
async function extractSteamOfferEndDate(appId, currencyCode) {
  const cc = getCurrencyConfig(currencyCode).cc;
  try {
    const htmlRes = await httpReq("GET",
      `https://store.steampowered.com/app/${appId}?cc=${cc}&l=english`, {
      headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
    });
    return extractOfferEndFromHtml(String(htmlRes.data));
  } catch (err) {
    logger("WARN", "PRICE_SEARCH", `Nu am putut extrage data expirării pentru app ${appId}`, err.message);
    return null;
  }
}

  Object.assign(ctx, {
    searchSteamGameByName,
    levenshtein,
    chooseBestSteamMatch,
    fetchSteamPriceDetails,
    extractOfferEndFromHtml,
    extractSteamOfferEndDate
  });
};
