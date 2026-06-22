"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail, errorMessage } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommandGroup(required: false): string | null;
    getSubcommand(): string;
    getString(name: string): string | null;
    getInteger(name: string): number | null;
  };
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

type GuildModelLike = {
  updateOne(filter: unknown, update: unknown, opts?: unknown): Promise<{ matchedCount?: number; modifiedCount?: number }>;
};

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

type GuildChannelSettings = { notificationChannelId?: string | null; discountChannelId?: string | null } | null;

type SetInteractionDeps = {
  GuildModel: GuildModelLike;
  invalidateGuildCache: (guildId: string) => void;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, content: string) => Promise<unknown>;
  logger: Logger;
  SUPPORTED_CURRENCIES: Record<string, unknown>;
  getGuildSettings?: (guildId: string) => Promise<GuildChannelSettings>;
  checkReadMessageHistory?: (interaction: DiscordInteraction, channelId: string) => Promise<boolean | null>;
};

type SetContext = SetInteractionDeps & {
  MessageFlags: { Ephemeral: number };
  handleInteraction?: NextInteractionHandler;
};

interface SetUpdatePlan {
  updateDoc: Record<string, unknown>;
  confirmMsg: string;
  isFilterChange: boolean;
  earlyReply?: string;
}

function buildSetUpdatePlan(
  sub: string,
  interaction: DiscordInteraction,
  supportedCurrencies: Record<string, unknown>
): SetUpdatePlan {
  const plan: SetUpdatePlan = { updateDoc: {}, confirmMsg: "", isFilterChange: false };

  if (sub === "mode") {
    const value = interaction.options.getString("value");
    if (value !== "compact" && value !== "detailed") {
      plan.earlyReply = "Eroare: `mode` accepta doar `compact` sau `detailed`.";
      return plan;
    }
    plan.updateDoc.notificationMode = value;
    plan.confirmMsg = `OK: Mod setat: **${value}**`;
    return plan;
  }

  if (sub === "mindiscount") {
    const min = interaction.options.getInteger("value");
    if (typeof min !== "number" || !Number.isFinite(min) || min < 0 || min > 100) {
      plan.earlyReply = "Eroare: `mindiscount` trebuie sa fie un intreg intre 0 si 100.";
      return plan;
    }
    plan.updateDoc.minDiscountPercent = min;
    plan.confirmMsg = `OK: Reducere minima: **${min}%**`;
    plan.isFilterChange = true;
    return plan;
  }

  if (sub === "maxprice") {
    const val = interaction.options.getInteger("value");
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val > 10000) {
      plan.earlyReply = "Eroare: `maxprice` trebuie sa fie un intreg intre 0 si 10000 (0 = dezactivat).";
      return plan;
    }
    plan.updateDoc.maxAbsolutePrice = val;
    plan.confirmMsg = val === 0
      ? "OK: Filtru pret maxim dezactivat."
      : `OK: Pret maxim setat: **${val}**`;
    plan.isFilterChange = true;
    return plan;
  }

  if (sub === "free") {
    const value = String(interaction.options.getString("value") || "");
    if (value !== "on" && value !== "off") {
      plan.earlyReply = "Eroare: `free` accepta doar `on` sau `off`.";
      return plan;
    }
    plan.updateDoc.includeFreeGames = value === "on";
    plan.confirmMsg = `OK: Jocuri free: **${value.toUpperCase()}**`;
    plan.isFilterChange = true;
    return plan;
  }

  if (sub === "paid") {
    const value = String(interaction.options.getString("value") || "");
    if (value !== "on" && value !== "off") {
      plan.earlyReply = "Eroare: `paid` accepta doar `on` sau `off`.";
      return plan;
    }
    plan.updateDoc.includePaidDiscounts = value === "on";
    plan.confirmMsg = `OK: Oferte platite: **${value.toUpperCase()}**`;
    plan.isFilterChange = true;
    return plan;
  }

  if (sub === "outbox-recovery-verify") {
    const value = String(interaction.options.getString("value") || "");
    if (value !== "on" && value !== "off") {
      plan.earlyReply = "Eroare: `outbox-recovery-verify` accepta doar `on` sau `off`.";
      return plan;
    }
    plan.updateDoc.outboxRecoveryVerify = value === "on";
    plan.confirmMsg = value === "on"
      ? "OK: Verificare recovery outbox: **ON** (extra fetch pe istoric la recovery, dar zero duplicate)."
      : "OK: Verificare recovery outbox: **OFF** (foloseste flag-ul global daca e setat).";
    return plan;
  }

  if (sub === "currency") {
    const value = interaction.options.getString("value");
    if (typeof value !== "string" || !value || !(value in supportedCurrencies)) {
      const supported = Object.keys(supportedCurrencies).join(", ");
      plan.earlyReply = `Eroare: \`currency\` trebuie sa fie una dintre: ${supported}.`;
      return plan;
    }
    plan.updateDoc.currency = value;
    plan.confirmMsg = `OK: Valuta setata: **${value}**`;
    plan.isFilterChange = true;
    return plan;
  }

  if (sub === "stores") {
    const raw = String(interaction.options.getString("value") || "").trim().toLowerCase();
    if (raw === "reset" || raw === "") {
      plan.updateDoc.enabledStores = [];
      plan.confirmMsg = "OK: Filtru store-uri resetat (toate active).";
      plan.isFilterChange = true;
      return plan;
    }
    const tokens = raw.split(",").map(s => s.trim()).filter(Boolean);
    const selected: string[] = [];
    for (const t of tokens) {
      if (t === "steam") selected.push("Steam");
      else if (t === "epic" || t === "epicgames" || t === "epic games") selected.push("Epic Games");
      else {
        plan.earlyReply = `Eroare: Store necunoscut: \`${t}\`. Valori valide: \`steam\`, \`epic\`. Pentru reset: \`reset\`.`;
        return plan;
      }
    }
    plan.updateDoc.enabledStores = Array.from(new Set(selected));
    plan.confirmMsg = `OK: Store-uri active: **${(plan.updateDoc.enabledStores as string[]).join(", ")}**`;
    plan.isFilterChange = true;
    return plan;
  }

  return plan;
}

function createSetInteractionHandler(deps: SetInteractionDeps) {
  const {
    GuildModel, invalidateGuildCache, formatUserError, safeDefer, safeEdit, logger,
    SUPPORTED_CURRENCIES, getGuildSettings, checkReadMessageHistory
  } = deps;

  async function readHistoryWarning(interaction: DiscordInteraction, guildId: string): Promise<string> {
    if (!getGuildSettings || !checkReadMessageHistory) return "";
    const settings = await getGuildSettings(guildId).catch(() => null);
    const channelIds = Array.from(new Set([settings?.notificationChannelId, settings?.discountChannelId]
      .filter((id): id is string => typeof id === "string" && id.length > 0)));
    if (!channelIds.length) return "";
    const missing: string[] = [];
    for (const channelId of channelIds) {
      const allowed = await checkReadMessageHistory(interaction, channelId).catch(() => null);
      if (allowed === false) missing.push(channelId);
    }
    if (!missing.length) return "";
    return `\n:warning: Botul nu are permisiunea **Read Message History** pe ${missing.map(id => `<#${id}>`).join(", ")}; recovery-verify nu poate citi istoricul si va trata fiecare reluare ca duplicat nedetectat.`;
  }

  async function handleSetInteraction(interaction: DiscordInteraction): Promise<unknown> {
    if (!interaction.guild) return undefined;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction);

    const plan = buildSetUpdatePlan(sub, interaction, SUPPORTED_CURRENCIES);

    if (plan.earlyReply) {
      return safeEdit(interaction, plan.earlyReply);
    }
    if (!plan.confirmMsg || Object.keys(plan.updateDoc).length === 0) {

      const group = interaction.options.getSubcommandGroup(false);
      logger("WARN", "SET_COMMAND", `Subcomanda /set necunoscuta: ${sub} (group=${group || "none"})`);
      return safeEdit(interaction, `Eroare: Subcomanda \`/set ${sub}\` nu este recunoscuta. Foloseste \`/help\` pentru lista.`);
    }

    const updateDoc: Record<string, unknown> = { ...plan.updateDoc };
    if (plan.isFilterChange) updateDoc.pendingDiscounts = [];

    try {
      await GuildModel.updateOne({ _id: guildId }, { $set: updateDoc }, { upsert: true });
      invalidateGuildCache(guildId);
      const tail = plan.isFilterChange ? " *(coada de pending a fost resetata)*" : "";
      const warning = updateDoc.outboxRecoveryVerify === true ? await readHistoryWarning(interaction, guildId) : "";
      return safeEdit(interaction, plan.confirmMsg + tail + warning);
    } catch (err: unknown) {
      logger("WARN", "SET_COMMAND", `Eroare la salvarea preferintelor pentru ${guildId}`, errorMessage(err));
      return safeEdit(interaction, formatUserError(err, "Eroare la salvarea preferintelor."));
    }
  }

  return { handleSetInteraction };
}

function isDirectSetCommand(interaction: DiscordInteraction): boolean {
  if (interaction?.isChatInputCommand?.() !== true) return false;
  if (!interaction.guild) return false;
  if (interaction.commandName !== "set") return false;
  const group = interaction.options?.getSubcommandGroup?.(false);
  return group !== "games" && group !== "role";
}

function buildSetCommandHandler(target: SetContext) {
  const handlers = createSetInteractionHandler({
    GuildModel: target.GuildModel,
    invalidateGuildCache: target.invalidateGuildCache,
    formatUserError: target.formatUserError,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    logger: target.logger,
    SUPPORTED_CURRENCIES: target.SUPPORTED_CURRENCIES,
    getGuildSettings: target.getGuildSettings,
    checkReadMessageHistory: target.checkReadMessageHistory
  });

  const command: CommandHandler = {
    canHandle: (interaction) => Boolean(isDirectSetCommand(interaction as DiscordInteraction)),
    handle: async (interaction) => {
      const di = interaction as DiscordInteraction;
      try {
        return await handlers.handleSetInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "SET_INTERACTION", "Eroare in handler-ul /set", errorDetail(err));
        const payload = { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

function installSetInteractionHandler(target: SetContext) {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildSetCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}

Object.assign(installSetInteractionHandler, { createSetInteractionHandler, buildSetUpdatePlan, buildCommandHandler: buildSetCommandHandler });

export = installSetInteractionHandler;
