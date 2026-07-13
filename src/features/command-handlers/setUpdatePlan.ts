"use strict";

import { normalizeNotificationTemplate } from "../notifications/notificationTemplate.js";

export type SetPlanInteraction = {
  options: {
    getString(name: string): string | null;
    getInteger(name: string): number | null;
  };
};

export interface SetUpdatePlan {
  updateDoc: Record<string, unknown>;
  confirmMsg: string;
  isFilterChange: boolean;
  earlyReply?: string;
}

export function buildSetUpdatePlan(
  sub: string,
  interaction: SetPlanInteraction,
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

  if (sub === "update-template" || sub === "discount-template") {
    const field = sub === "update-template" ? "updateMessageTemplate" : "discountMessageTemplate";
    const label = sub === "update-template" ? "update-uri" : "reduceri";
    const template = normalizeNotificationTemplate(interaction.options.getString("value"));
    plan.updateDoc[field] = template;
    plan.confirmMsg = template
      ? `OK: Sablon mesaj pentru ${label} setat: ${template}`
      : `OK: Sablon mesaj pentru ${label} resetat la implicit (doar mentiunea de rol, daca e configurata).`;
    return plan;
  }

  return plan;
}
