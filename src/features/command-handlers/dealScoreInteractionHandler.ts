"use strict";

import type { DealInfo, GameConfig, GuildSettings, PriceValue } from "../../types";
import type { CommandHandler } from "../command-registry/commandHandler";
import { matchesCommand } from "../command-registry/commandMatch";

import { errorDetail, errorMessage } from "../../shared/errors";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, extra?: Record<string, unknown>) => void;

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getString(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
}

interface DealScoreDeps {
  logger: Logger;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  startCommandLog(interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>): CommandLogEnd;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  getDealsCacheData(currency: string): DealInfo[] | null;
  setDealsCache(currency: string, deals: DealInfo[]): void;
  fetchDeals(opts: { currency: string }): Promise<DealInfo[]>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  formatPrice(value: PriceValue, currencyCode?: string | null): string;
  DEFAULT_CURRENCY: string;
  MessageFlags: { Ephemeral: number };
}

type DealScoreContext = DealScoreDeps;

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numericPrice(value: PriceValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function discountPercent(deal: DealInfo): number {
  if (typeof deal.discountPercent === "number" && Number.isFinite(deal.discountPercent)) return Math.max(0, Math.min(100, deal.discountPercent));
  const savings = numericPrice(deal.savings);
  if (savings !== null) return Math.max(0, Math.min(100, savings));
  const normal = numericPrice(deal.normalPrice);
  const sale = numericPrice(deal.salePrice);
  if (normal && sale !== null && normal > 0 && sale <= normal) return Math.round(((normal - sale) / normal) * 100);
  return 0;
}

function titleMatches(query: string, title: string): boolean {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (!q || !t) return false;
  if (q === t || t.includes(q) || q.includes(t)) return true;
  const queryTokens = q.split(" ").filter(token => token.length >= 2);
  const titleTokens = new Set(t.split(" ").filter(token => token.length >= 2));
  if (!queryTokens.length || !titleTokens.size) return false;
  const shared = queryTokens.filter(token => titleTokens.has(token)).length;
  return shared / queryTokens.length >= 0.75;
}

function scoreDeal(deal: DealInfo): { score: number; reasons: string[] } {
  const discount = discountPercent(deal);
  const sale = numericPrice(deal.salePrice);
  const normal = numericPrice(deal.normalPrice);
  const quality = typeof deal.qualityScore === "number" && Number.isFinite(deal.qualityScore) ? Math.max(0, Math.min(100, deal.qualityScore)) : 0;
  const popularity = typeof deal.popularityScore === "number" && Number.isFinite(deal.popularityScore) ? Math.max(0, Math.min(100, deal.popularityScore)) : 0;
  let points = 0;
  points += Math.min(4, discount / 20);
  if (sale !== null) {
    if (sale <= 5) points += 2;
    else if (sale <= 15) points += 1.4;
    else if (sale <= 30) points += 0.8;
    else points += 0.3;
  }
  if (normal !== null && sale !== null && normal > sale) points += Math.min(1, (normal - sale) / Math.max(normal, 1));
  points += quality / 100;
  points += popularity / 200;
  points += String(deal.store || "").toLowerCase().includes("steam") ? 0.4 : 0.2;
  const score = Math.max(1, Math.min(10, Math.round(points * 10) / 10));
  const reasons = [
    `reducere ${discount}%`,
    sale !== null ? `pret curent ${sale}` : "pret curent necunoscut",
    quality > 0 ? `calitate ${Math.round(quality)}%` : "calitate indisponibila",
    popularity > 0 ? `popularitate ${Math.round(popularity)}%` : "popularitate indisponibila"
  ];
  return { score, reasons };
}

function findBestDeal(deals: DealInfo[], query: string): DealInfo | null {
  const matches = deals.filter(deal => titleMatches(query, String(deal.title || "")));
  if (!matches.length) return null;
  return matches
    .map(deal => ({ deal, scored: scoreDeal(deal) }))
    .sort((a, b) => b.scored.score - a.scored.score)[0].deal;
}

function createDealScoreInteractionHandler(deps: DealScoreDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit, getDealsCacheData,
    setDealsCache, fetchDeals, getGuildSettings, formatPrice, DEFAULT_CURRENCY
  } = deps;

  async function loadDeals(currency: string): Promise<{ deals: DealInfo[]; error: string | null }> {
    const cached = getDealsCacheData(currency);
    if (cached) return { deals: cached, error: null };
    try {
      const deals = await fetchDeals({ currency });
      setDealsCache(currency, deals);
      return { deals, error: null };
    } catch (err: unknown) {
      return { deals: [], error: errorMessage(err) };
    }
  }

  async function handleDealScore(interaction: DiscordInteraction): Promise<unknown> {
    const query = String(interaction.options.getString("game", true) || "").trim();
    if (!query) return interaction.reply?.({ content: "Eroare: trebuie sa specifici jocul.", flags: deps.MessageFlags.Ephemeral });
    if (!(await enforceCooldown(interaction, "deal-score"))) return undefined;
    const endLog = startCommandLog(interaction, "deal-score", { query });
    await safeDefer(interaction);
    const guild = interaction.guild?.id ? await getGuildSettings(interaction.guild.id) : null;
    const currency = String(guild?.currency || DEFAULT_CURRENCY);
    const loaded = await loadDeals(currency);
    if (loaded.error) {
      endLog("source_error", { errorMsg: loaded.error });
      return safeEdit(interaction, `Eroare: nu am putut incarca ofertele pentru scor acum: ${loaded.error}`);
    }
    const deal = findBestDeal(loaded.deals, query);
    if (!deal) {
      endLog("not_found");
      return safeEdit(interaction, `Nu am gasit o oferta activa comparabila pentru \`${query}\`.`);
    }
    const scored = scoreDeal(deal);
    const sale = numericPrice(deal.salePrice);
    const price = sale === null ? String(deal.salePrice || "pret indisponibil") : formatPrice(sale, String(deal.currency || currency));
    endLog("ok", { score: scored.score });
    return safeEdit(interaction, {
      embeds: [{
        title: `Deal score: ${deal.title || query}`,
        url: String(deal.link || deal.url || ""),
        color: scored.score >= 8 ? 0x2ecc71 : scored.score >= 6 ? 0xf1c40f : 0xe67e22,
        description: `Scor: **${scored.score}/10**\nPret: **${price}**\nMagazin: **${deal.store || "necunoscut"}**`,
        fields: [{ name: "Motive", value: scored.reasons.join("\n"), inline: false }]
      }]
    });
  }

  return { handleDealScore };
}

function isDealScoreCommand(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["deal-score"] });
}

function buildDealScoreCommandHandler(target: DealScoreContext) {
  const handlers = createDealScoreInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isDealScoreCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      try {
        return await handlers.handleDealScore(interaction);
      } catch (err: unknown) {
        target.logger("ERROR", "DEAL_SCORE", "Eroare in /deal-score", errorDetail(err));
        const payload = { content: "Eroare: nu am putut calcula scorul ofertei.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") await interaction.followUp(payload);
          else if (typeof interaction.reply === "function") await interaction.reply(payload);
        } catch {}
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

export default {
  createDealScoreInteractionHandler,
  scoreDeal,
  findBestDeal,
  buildCommandHandler: buildDealScoreCommandHandler
};
