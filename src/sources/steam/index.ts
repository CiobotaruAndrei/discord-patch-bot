import type {
  CurrencyCode,
  CurrencyConfig,
  HttpRequestOptions,
  LoggerFunction,
  SteamSearchItem
} from "../../types";
import { levenshtein } from "../../native/fuzzy";

type SteamCurrencyCode = CurrencyCode | string | null | undefined;
type HttpResponse<T = unknown> = { data: T };
type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<any>>;
type CheerioLoader = (html: unknown) => any;

interface ChooseBestSteamMatchOptions {
  forceGameOnly?: boolean;
}

interface SteamSearchResponse {
  items?: SteamSearchItem[];
}

type SteamDetailsResponse = Record<string, { data?: unknown } | undefined>;

interface SteamContext {
  logger: LoggerFunction;
  getCurrencyConfig: (code?: SteamCurrencyCode) => CurrencyConfig;
  httpReq: HttpReq;
  safeCheerioLoad: CheerioLoader;
  searchSteamGameByName?: typeof searchSteamGameByName;
  levenshtein?: typeof levenshtein;
  chooseBestSteamMatch?: typeof chooseBestSteamMatch;
  fetchSteamPriceDetails?: typeof fetchSteamPriceDetails;
  extractOfferEndFromHtml?: typeof extractOfferEndFromHtml;
  extractSteamOfferEndDate?: typeof extractSteamOfferEndDate;
  [key: string]: unknown;
}

let runtimeContext: Pick<SteamContext, "logger" | "getCurrencyConfig" | "httpReq" | "safeCheerioLoad">;

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return String(err);
}

async function searchSteamGameByName(query: string, currencyCode?: SteamCurrencyCode): Promise<SteamSearchItem[]> {
  const cc = runtimeContext.getCurrencyConfig(currencyCode).cc;
  const searchRes = await runtimeContext.httpReq("GET",
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=${cc}&l=english`,
    { largeJson: true });
  const data = searchRes.data as SteamSearchResponse | undefined;
  return data?.items || [];
}

function chooseBestSteamMatch(
  items: SteamSearchItem[] | null | undefined,
  query: string,
  options: ChooseBestSteamMatchOptions = {}
): SteamSearchItem | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const { forceGameOnly = false } = options;
  const normalize = (str: unknown): string => String(str).toLowerCase()
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

async function fetchSteamPriceDetails(appId: string | number, currencyCode?: SteamCurrencyCode): Promise<unknown | null> {
  const cc = runtimeContext.getCurrencyConfig(currencyCode).cc;
  const detailsRes = await runtimeContext.httpReq("GET",
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${cc}&l=english`,
    { largeJson: true });
  const data = (detailsRes.data || {}) as SteamDetailsResponse;
  return data[String(appId)]?.data || null;
}

function extractOfferEndFromHtml(html: unknown): string | null {
  let cheerioThrew = false;
  try {
    const $ = runtimeContext.safeCheerioLoad(html);
    const cdText = $(".game_purchase_discount_countdown").first().text().trim();
    if (cdText) {
      const match = cdText.match(/(?:Offer|Sale|Special\s+promotion)\s+ends\s+([^<\n]+)/i)
        || cdText.match(/Daily\s+Deal!?\s*Offer\s+ends\s+([^<\n]+)/i);
      if (match && match[1]) return match[1].trim().slice(0, 200).replace(/\s{2,}/g, " ");
    }

    // V11: scope fallback-ul la zona de cumparare a jocului principal. Steam
    // pune adesea reclame in sidebar / "Customers also bought" cu propriile
    // "Offer ends ..." — daca scanam tot body-ul putem prinde data unei oferte
    // pentru un cu totul alt joc. .game_area_purchase /.game_purchase_action
    // sunt ancorate de blocul de pret al produsului curent.
    const scopedText = $(".game_area_purchase, .game_purchase_action, .discount_block").text();
    const candidates = [
      /Offer ends\s+([^<\n]+)/i,
      /Sale ends\s+([^<\n]+)/i,
      /Special promotion ends\s+([^<\n]+)/i,
      /Daily Deal!?\s*Offer ends\s+([^<\n]+)/i
    ];
    for (const re of candidates) {
      const match = scopedText.match(re);
      if (match && match[1]) return match[1].trim().slice(0, 200).replace(/\s{2,}/g, " ");
    }
  } catch {
    cheerioThrew = true;
  }

  // V11: raw HTML fallback ruleaza DOAR cand cheerio a aruncat (HTML invalid
  // sever). Daca cheerio a parsat cu succes dar n-am gasit textul in
  // containerele de cumparare ancorate, returnam null in loc sa cautam in tot
  // documentul — caz in care am putea prinde "Offer ends ..." dintr-un sidebar
  // de produs nelegat.
  if (!cheerioThrew) return null;
  const rawMatch = String(html || "").match(/Offer ends\s+([^<\n]+)/i);
  return rawMatch && rawMatch[1] ? rawMatch[1].trim().slice(0, 200) : null;
}

async function extractSteamOfferEndDate(appId: string | number, currencyCode?: SteamCurrencyCode): Promise<string | null> {
  const cc = runtimeContext.getCurrencyConfig(currencyCode).cc;
  try {
    const htmlRes = await runtimeContext.httpReq("GET",
      `https://store.steampowered.com/app/${appId}?cc=${cc}&l=english`, {
      headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
    });
    return extractOfferEndFromHtml(String(htmlRes.data));
  } catch (err) {
    runtimeContext.logger("WARN", "PRICE_SEARCH", `Nu am putut extrage data expirarii pentru app ${appId}`, errorMessage(err));
    return null;
  }
}

function attachSteam(ctx: SteamContext): void {
  runtimeContext = {
    logger: ctx.logger,
    getCurrencyConfig: ctx.getCurrencyConfig,
    httpReq: ctx.httpReq,
    safeCheerioLoad: ctx.safeCheerioLoad
  };

  Object.assign(ctx, {
    searchSteamGameByName,
    levenshtein,
    chooseBestSteamMatch,
    fetchSteamPriceDetails,
    extractOfferEndFromHtml,
    extractSteamOfferEndDate
  });
}

export = attachSteam;
