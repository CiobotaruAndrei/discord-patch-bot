import { requestOptionsFor } from "../sourcePolicies.js";
import type { CheerioAPI } from "cheerio";
import type {
  CurrencyCode,
  CurrencyConfig,
  HttpRequestOptions,
  LoggerFunction,
  SteamSearchItem
} from "../../types.js";
import { levenshtein } from "../../native/fuzzy.js";
import type { SteamSourceApi, ChooseBestSteamMatchOptions, SteamAppDetailsSummary, SteamCurrentPlayersSummary } from "../sourceApis.js";
import { errorMessage } from "../../shared/errors.js";
import { decodeSteamDetailsResponse, decodeSteamSearchResponse } from "../responseDecoders.js";

type SteamCurrencyCode = CurrencyCode | string | null | undefined;
type HttpResponse<T = unknown> = { data: T };
type HttpReq = (
  method: string,
  url: string,
  options?: HttpRequestOptions,
  retries?: number,
  backoff?: number
) => Promise<HttpResponse<unknown>>;
type CheerioLoader = (html: unknown) => CheerioAPI;

interface SteamSearchResponse {
  items?: SteamSearchItem[];
}

type SteamDetailsResponse = Record<string, { data?: SteamAppDetailsSummary } | undefined>;

interface SteamSourceDeps {
  logger: LoggerFunction;
  getCurrencyConfig: (code?: SteamCurrencyCode) => CurrencyConfig;
  httpReq: HttpReq;
  safeCheerioLoad: CheerioLoader;
}

type SteamSourceContext = SteamSourceDeps & Partial<SteamSourceApi>;

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

function createSteamSource(deps: SteamSourceDeps): SteamSourceApi {
  const { logger, getCurrencyConfig, httpReq, safeCheerioLoad } = deps;

  async function searchSteamGameByName(query: string, currencyCode?: SteamCurrencyCode): Promise<SteamSearchItem[]> {
    const cc = getCurrencyConfig(currencyCode).cc;
    const searchRes = await httpReq("GET",
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&cc=${cc}&l=english`,
      requestOptionsFor("steam-search"));
    const data = decodeSteamSearchResponse(searchRes.data);
    return data?.items || [];
  }

  async function fetchSteamPriceDetails(appId: string | number, currencyCode?: SteamCurrencyCode): Promise<SteamAppDetailsSummary | null> {
    const cc = getCurrencyConfig(currencyCode).cc;
    const detailsUrl = new URL("https://store.steampowered.com/api/appdetails");
    detailsUrl.searchParams.set("appids", String(appId));
    detailsUrl.searchParams.set("cc", cc);
    detailsUrl.searchParams.set("l", "english");
    const detailsRes = await httpReq("GET", detailsUrl.toString(), requestOptionsFor("steam-appdetails"));
    const data = decodeSteamDetailsResponse(detailsRes.data || {});
    return data[String(appId)]?.data || null;
  }

  function recordValue(value: unknown, key: string): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.entries(value).find(([entryKey]) => entryKey === key)?.[1];
  }

  function parseCurrentPlayers(data: unknown, appId: string): SteamCurrentPlayersSummary {
    const response = recordValue(data, "response");
    const rawCount = recordValue(response, "player_count");
    const parsed = typeof rawCount === "number" ? rawCount : Number(rawCount);
    const success = Number.isFinite(parsed) && parsed >= 0;
    return { appId, playerCount: success ? Math.floor(parsed) : 0, success };
  }

  async function fetchSteamCurrentPlayers(appId: string | number): Promise<SteamCurrentPlayersSummary> {
    const url = new URL("https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/");
    url.searchParams.set("appid", String(appId));
    const playersRes = await httpReq("GET", url.toString(), requestOptionsFor("steam-players"));
    return parseCurrentPlayers(playersRes.data, String(appId));
  }

  function extractOfferEndFromHtml(html: unknown): string | null {
    let cheerioThrew = false;
    try {
      const $ = safeCheerioLoad(html);
      const cdText = $(".game_purchase_discount_countdown").first().text().trim();
      if (cdText) {
        const match = cdText.match(/(?:Offer|Sale|Special\s+promotion)\s+ends\s+([^<\n]+)/i)
          || cdText.match(/Daily\s+Deal!?\s*Offer\s+ends\s+([^<\n]+)/i);
        if (match && match[1]) return match[1].trim().slice(0, 200).replace(/\s{2,}/g, " ");
      }

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

    if (!cheerioThrew) return null;
    const rawText = String(html || "");
    const rawCandidates = [
      /Offer ends\s+([^<\n]+)/i,
      /Sale ends\s+([^<\n]+)/i,
      /Special promotion ends\s+([^<\n]+)/i,
      /Daily Deal!?\s*Offer ends\s+([^<\n]+)/i
    ];
    for (const re of rawCandidates) {
      const match = rawText.match(re);
      if (match && match[1]) return match[1].trim().slice(0, 200).replace(/\s{2,}/g, " ");
    }
    return null;
  }

  async function extractSteamOfferEndDate(appId: string | number, currencyCode?: SteamCurrencyCode): Promise<string | null> {
    const cc = getCurrencyConfig(currencyCode).cc;
    try {
      const safeAppId = encodeURIComponent(String(appId));
      const htmlUrl = new URL(`https://store.steampowered.com/app/${safeAppId}`);
      htmlUrl.searchParams.set("cc", cc);
      htmlUrl.searchParams.set("l", "english");
      const htmlRes = await httpReq("GET", htmlUrl.toString(), {
        ...requestOptionsFor("steam-offer-end-html"),
        headers: { "Cookie": "birthtime=283993201; mature_content=1;" }
      });
      return extractOfferEndFromHtml(String(htmlRes.data));
    } catch (err) {
      logger("WARN", "PRICE_SEARCH", `Nu am putut extrage data expirarii pentru app ${appId}`, errorMessage(err));
      return null;
    }
  }

  return {
    searchSteamGameByName,
    levenshtein,
    chooseBestSteamMatch,
    fetchSteamPriceDetails,
    fetchSteamCurrentPlayers,
    extractOfferEndFromHtml,
    extractSteamOfferEndDate
  };
}

function buildSteamFrom(target: SteamSourceContext) {
  return createSteamSource({
    logger: target.logger,
    getCurrencyConfig: target.getCurrencyConfig,
    httpReq: target.httpReq,
    safeCheerioLoad: target.safeCheerioLoad
  });
}

const steamSourceModule = {
  buildFrom: buildSteamFrom,
  createSteamSource,
  chooseBestSteamMatch
};

export default steamSourceModule;
