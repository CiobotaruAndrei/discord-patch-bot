import { requestOptionsFor } from "../sourcePolicies.js";
import type { CheerioAPI } from "cheerio";
import type { GameConfig, NormalizedUpdate, PatchUpdate } from "../../types.js";
import { rankListingCandidates } from "../../native/fuzzy.js";
import { errorMessage } from "../../shared/errors.js";
import type { ListingCandidate } from "../sourceApis.js";
import { absoluteUrl, getArticleHrefRegex, scoreCandidate } from "./updateHelpers.js";
import type { CheerioSelector, HttpReq, RunConcurrent, SchemaDriftErrorClass } from "./updateHelpers.js";

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

    type FetchedListing = { url: string; candidates: ListingCandidate[] };
    const fetched: Array<FetchedListing | null> = new Array(listingUrls.length).fill(null);
    await deps.runConcurrent(listingUrls, deps.FETCH_CONCURRENCY_LISTING, async (url, index) => {
      const listRes = await httpReq("GET", url, requestOptionsFor("listing-index"));
      const $ = safeCheerioLoad(listRes.data);
      const candidates: ListingCandidate[] = [];
      let localPosition = 0;
      $("a").each((i: number, el: unknown) => {
        const node = el as CheerioSelector;
        const href = absoluteUrl(game.baseUrl, $(node).attr("href"));
        if (!href || (hrefRegex && !hrefRegex.test(href))) return;
        const candidate = { href, text: cleanText($(node).text()), position: localPosition++ };
        if (keywords.length > 0 && scoreCandidate(candidate, keywords) === 0) return;
        candidates.push(candidate);
      });
      fetched[index] = { url: String(url), candidates };
    }, {
      errorLogger: (url, err) => logger("WARN", "SCRAPE", `Eroare preluare listing url ${url}`, errorMessage(err))
    });

    const collected: ListingCandidate[] = [];
    let listingFetched = 0;
    let globalPosition = 0;
    for (const entry of fetched) {
      if (!entry) continue;
      listingFetched++;
      for (const c of entry.candidates) {
        collected.push({ href: c.href, text: c.text, position: globalPosition++ });
      }
    }

    const seen = new Set<string>();
    const unique = collected.filter(item => {
      if (!item.href || seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    });
    const ranked = rankListingCandidates(unique, keywords);

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
