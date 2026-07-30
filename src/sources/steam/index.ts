import { requestOptionsFor } from "../sourcePolicies.js";
import type { CheerioAPI } from "cheerio";
import type { CurrencyCode, CurrencyConfig, LoggerFunction } from "../../types.js";
import type { HttpRequestOptions } from "../httpRequestTypes.js";
import type { SteamSearchItem } from "../sourceTypes.js";
import { chooseBestSteamMatchIndex, levenshtein } from "../../native/fuzzy.js";
import type { SteamSourceApi, ChooseBestSteamMatchOptions, SteamAppDetailsSummary, SteamCurrentPlayersSummary, SteamLatestUpdateSizeSummary } from "../sourceApis.js";
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

interface SteamSourceDeps {
  logger: LoggerFunction;
  getCurrencyConfig: (code?: SteamCurrencyCode) => CurrencyConfig;
  httpReq: HttpReq;
  safeCheerioLoad: CheerioLoader;
}



function chooseBestSteamMatch(
  items: SteamSearchItem[] | null | undefined,
  query: string,
  options: ChooseBestSteamMatchOptions = {}
): SteamSearchItem | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const { forceGameOnly = false } = options;
  const index = chooseBestSteamMatchIndex(items, String(query ?? ""), forceGameOnly);
  return index >= 0 && index < items.length ? items[index] : null;
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

  function explicitUpdateSize(text: string): string | null {
    const normalized = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const afterKeyword = /(?:update|patch|download)(?:\s+size)?[^.!?]{0,80}?(\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|TB))/i.exec(normalized);
    if (afterKeyword?.[1]) return afterKeyword[1].replace(",", ".").replace(/\s+/g, " ").toUpperCase();
    const beforeKeyword = /(\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|TB))[^.!?]{0,40}?(?:update|patch|download)/i.exec(normalized);
    return beforeKeyword?.[1] ? beforeKeyword[1].replace(",", ".").replace(/\s+/g, " ").toUpperCase() : null;
  }

  async function fetchSteamLatestUpdateSize(appId: string | number): Promise<SteamLatestUpdateSizeSummary> {
    const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
    url.searchParams.set("appid", String(appId));
    url.searchParams.set("count", "10");
    url.searchParams.set("maxlength", "12000");
    url.searchParams.set("format", "json");
    const response = await httpReq("GET", url.toString(), requestOptionsFor("steam-news"));
    const appNews = recordValue(response.data, "appnews");
    const newsItems = recordValue(appNews, "newsitems");
    if (!Array.isArray(newsItems)) return { size: null, title: null, publishedAt: null, sourceUrl: null };
    for (const item of newsItems) {
      const titleValue = recordValue(item, "title");
      const contentValue = recordValue(item, "contents");
      const title = typeof titleValue === "string" ? titleValue : "";
      const content = typeof contentValue === "string" ? contentValue : "";
      if (!/(update|patch|hotfix)/i.test(`${title} ${content}`)) continue;
      const size = explicitUpdateSize(`${title} ${content}`);
      if (!size) continue;
      const dateValue = recordValue(item, "date");
      const timestamp = typeof dateValue === "number" ? dateValue : Number(dateValue);
      const urlValue = recordValue(item, "url");
      return {
        size,
        title: title || null,
        publishedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000) : null,
        sourceUrl: typeof urlValue === "string" && urlValue.startsWith("https://") ? urlValue : null
      };
    }
    return { size: null, title: null, publishedAt: null, sourceUrl: null };
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
    fetchSteamLatestUpdateSize,
    extractOfferEndFromHtml,
    extractSteamOfferEndDate
  };
}

const steamSourceModule = {
  createSteamSource,
  chooseBestSteamMatch
};

export default steamSourceModule;
