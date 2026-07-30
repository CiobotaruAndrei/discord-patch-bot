import { requestOptionsFor } from "../sourcePolicies.js";
import type { CheerioAPI } from "cheerio";
import type { GameConfig } from "../../config/configTypes.js";
import type { NormalizedUpdate, PatchUpdate } from "../sourceTypes.js";
import { extractAndRankListingCandidates } from "../../native/fuzzy.js";
import type { ListingAnchorInput } from "../../native/fuzzy.js";
import { errorMessage } from "../../shared/errors.js";
import { absoluteUrl, getArticleHrefRegex } from "./updateHelpers.js";
import type { CheerioSelector, HttpReq, RunConcurrent, SchemaDriftErrorClass } from "./updateHelpers.js";

const LISTING_RANKED_LIMIT = 3;

interface ListingUpdatesDeps {
  httpReq: HttpReq;
  safeCheerioLoad: (html: unknown) => CheerioAPI;
  cleanText: (text: unknown) => string;
  normalizeUpdate: (data: PatchUpdate) => NormalizedUpdate;
  logger: (level: string, context: string, message: string, meta?: unknown) => void;
  SchemaDriftError: SchemaDriftErrorClass;
  runConcurrent: RunConcurrent;
  FETCH_CONCURRENCY_LISTING: number;
}

function createListingUpdates(deps: ListingUpdatesDeps) {
  async function fetchListingBasedUpdate(game: GameConfig): Promise<NormalizedUpdate> {
    const { httpReq, safeCheerioLoad, cleanText, normalizeUpdate, logger, SchemaDriftError } = deps;
    const rawListingUrls: Array<string | undefined> = Array.isArray(game.listingUrls) && game.listingUrls.length
      ? game.listingUrls : [game.listingUrl];
    const listingUrls: string[] = rawListingUrls.filter(
      (u): u is string => typeof u === "string" && u.trim().length > 0
    );
    if (listingUrls.length === 0) {
      throw new Error(`Nu am URL-uri de listing valide pentru ${game.key} (verifica config.json).`);
    }
    const keywords = Array.isArray(game.requireKeywords) ? game.requireKeywords : [];
    const hrefRegex = getArticleHrefRegex(game);

    type FetchedListing = { url: string; anchors: ListingAnchorInput[] };
    const fetched: Array<FetchedListing | null> = new Array(listingUrls.length).fill(null);
    await deps.runConcurrent(listingUrls, deps.FETCH_CONCURRENCY_LISTING, async (url, index) => {
      const listRes = await httpReq("GET", url, requestOptionsFor("listing-index"));
      const $ = safeCheerioLoad(listRes.data);
      const anchors: ListingAnchorInput[] = [];
      $("a").each((i: number, el: unknown) => {
        const node = el as CheerioSelector;
        const href = absoluteUrl(game.baseUrl, $(node).attr("href"));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        anchors.push({ href, rawText: $(node).text() });
      });
      fetched[index] = { url: String(url), anchors };
    }, {
      errorLogger: (url, err) => logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, errorMessage(err))
    });

    const anchors: ListingAnchorInput[] = [];
    let listingFetched = 0;
    for (const entry of fetched) {
      if (!entry) continue;
      listingFetched++;
      for (const anchor of entry.anchors) anchors.push(anchor);
    }

    const ranked = extractAndRankListingCandidates(anchors, keywords, LISTING_RANKED_LIMIT);

    if (!ranked.length) {
      if (listingFetched > 0) {
        throw new SchemaDriftError(
          `Listing fetch-uit cu succes dar 0 ancore valide pentru ${game.key}`,
          `listing:${game.key}`
        );
      }
      throw new Error("Nu am găsit ancore valide.");
    }
    const TRY_LIMIT = Math.min(3, ranked.length);
    let lastErr: unknown = null;
    for (let i = 0; i < TRY_LIMIT; i++) {
      const candidate = ranked[i];
      const articleUrl = candidate.href;
      try {
        const articleRes = await httpReq("GET", articleUrl, requestOptionsFor("listing-article"));
        const $art = safeCheerioLoad(articleRes.data || "");
        const ogTitle = $art('meta[property="og:title"]').attr("content") || $art("title").text() || "";
        const ogDesc = $art('meta[property="og:description"]').attr("content") || "";
        $art("script, style, nav, footer, header").remove();
        const rawContent = $art("article").text() || $art("main").text() || $art("body").text();
        return normalizeUpdate({
          id: String(articleUrl),
          title: cleanText(ogTitle) || `${game.name} Update`,
          link: articleUrl,
          excerpt: cleanText(ogDesc),
          fullText: cleanText(rawContent),
          thumbnail: game.thumbnail
        });
      } catch (err) {
        lastErr = err;
        logger("WARN", "FETCH_UPDATES", `Articol indisponibil pentru ${game.key} (candidat ${i + 1}/${TRY_LIMIT}): ${articleUrl}`, errorMessage(err));
      }
    }

    throw new Error(
      `Niciun articol nu a raspuns din primii ${TRY_LIMIT} candidati pentru ${game.key}: ${errorMessage(lastErr)}`
    );
  }

  return { fetchListingBasedUpdate };
}

export { createListingUpdates };
export type { ListingUpdatesDeps };
