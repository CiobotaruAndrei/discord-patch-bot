"use strict";

import type { DealInfo } from "../../../types";

const { errorMessage } = require("../../../shared/errors");

type NotificationMode = "compact" | "detailed";

const SNAPSHOT_FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

interface DiscordInteraction {
  guild?: { id: string } | null;
  user?: { id: string };
}

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

interface GuildSettingsLite {
  currency?: string;
  notificationMode?: NotificationMode;
}

export interface LatestDealsHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown | null>;
  getDealsCacheData: (currency: string) => DealInfo[] | null;
  setDealsCache: (currency: string, deals: DealInfo[]) => void;
  fetchDeals: (opts: { currency: string }) => Promise<DealInfo[]>;
  loadFetchSnapshot?: (id: string) => Promise<{ payload: unknown; fetchedAt: Date } | null>;
  validatePendingDiscountSnapshot: (snapshot: unknown) => snapshot is DealInfo;
  enrichDealData: (deal: DealInfo, currency: string) => Promise<DealInfo>;
  dealPassesFilters: (deal: DealInfo, guild: GuildSettingsLite | null) => boolean;
  getSystemTimes: () => Promise<{ reduceri?: number }>;
  saveSystemTime: (key: string, value: number) => Promise<unknown>;
  smoothTime: (estimate: number, actual: number) => number;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLite | null>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  buildDealEmbed: (deal: unknown, mode: NotificationMode, currency: string) => { setFooter: (opts: { text: string }) => unknown };
  handlePagination: (
    msg: unknown,
    authorId: string,
    prefix: string,
    items: unknown[],
    itemsPerPage: number,
    generateEmbedsFn: (page: number, totalP: number, mode: NotificationMode) => Promise<unknown[]> | unknown[],
    defaultMode?: NotificationMode
  ) => Promise<void>;
  DEFAULT_CURRENCY: string;
  ITEMS_PER_PAGE: number;
  MAX_DEALS: number;
}

export function createLatestDealsHandler(deps: LatestDealsHandlerDeps) {
  const {
    logger, enforceCooldown, startCommandLog, safeDefer, safeEdit,
    getDealsCacheData, setDealsCache, fetchDeals, loadFetchSnapshot, validatePendingDiscountSnapshot, enrichDealData, dealPassesFilters,
    getSystemTimes, saveSystemTime, smoothTime,
    getGuildSettings, formatUserError, buildDealEmbed, handlePagination,
    DEFAULT_CURRENCY, ITEMS_PER_PAGE, MAX_DEALS
  } = deps;

  async function handleLatestDeals(interaction: DiscordInteraction) {
    if (!(await enforceCooldown(interaction, "latest reduceri"))) return;
    const endLog = startCommandLog(interaction, "latest reduceri");
    await safeDefer(interaction);

    const guildId = interaction.guild?.id;
    const guild = guildId ? await getGuildSettings(guildId) : null;
    const currency = guild?.currency || DEFAULT_CURRENCY;
    const mode: NotificationMode = guild?.notificationMode || "detailed";

    let deals = getDealsCacheData(currency);
    let snapshotAgeMin: number | null = null;
    if (!deals) {
      const estMs = (await getSystemTimes()).reduceri || 10000;
      await safeEdit(interaction, `Se incarca: *Durata estimata: **${Math.max(1, Math.ceil(estMs / 1000))} secunde***`);
      const startTime = Date.now();
      try {
        deals = await fetchDeals({ currency });
        setDealsCache(currency, deals);
        await saveSystemTime("reduceri", smoothTime(estMs, Date.now() - startTime));
      } catch (err: unknown) {
        const snapshot = loadFetchSnapshot ? await loadFetchSnapshot(`deals:${currency}`).catch(() => null) : null;
        const ageMs = snapshot ? Date.now() - new Date(snapshot.fetchedAt).getTime() : Number.POSITIVE_INFINITY;
        const validDeals = snapshot && Array.isArray(snapshot.payload) && ageMs <= SNAPSHOT_FALLBACK_MAX_AGE_MS
          ? snapshot.payload.filter(validatePendingDiscountSnapshot)
          : [];
        if (!validDeals.length) {
          endLog("error", { errorMsg: errorMessage(err) });
          return safeEdit(interaction, formatUserError(err, "Nu am putut interoga magazinele.", "ERR_LATEST_DEALS"));
        }
        logger("WARN", "LATEST_DEALS", `Fetch live esuat, folosesc snapshot-ul persistat pentru ${currency}`, errorMessage(err));
        snapshotAgeMin = Math.max(1, Math.round(ageMs / 60000));
        deals = validDeals;
      }
    }
    const top = deals.filter(d => dealPassesFilters(d, guild)).slice(0, MAX_DEALS);
    if (!top.length) {
      endLog("no_data");
      return safeEdit(interaction, "Eroare: Nu am gasit oferte care sa corespunda setarilor serverului.");
    }
    const msg = await safeEdit(interaction, snapshotAgeMin === null
      ? "OK: Oferte incarcate!"
      : `OK: Oferte incarcate din ultimul snapshot salvat (fetch-ul live a esuat) - vechime ~${snapshotAgeMin} min.`);
    const generateEmbeds = async (page: number, totalP: number, currentMode: NotificationMode) => {
      const chunk = top.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);
      const dealsToRender = currentMode === "compact"
        ? chunk
        : await Promise.all(chunk.map(async (deal) => {
            try { return await enrichDealData(deal, currency); }
            catch (err: unknown) {
              logger("WARN", "ENRICH", "Eroare enrich command handler", errorMessage(err));
              return deal;
            }
          }));
      return dealsToRender.map((d) => buildDealEmbed(d, currentMode, currency).setFooter({ text: `Pagina ${page + 1}/${totalP}` }));
    };
    endLog("ok", { resultCount: top.length });
    if (msg && interaction.user) {
      await handlePagination(msg, interaction.user.id, "deals", top, ITEMS_PER_PAGE, generateEmbeds, mode);
    }
  }

  return { handleLatestDeals };
}
