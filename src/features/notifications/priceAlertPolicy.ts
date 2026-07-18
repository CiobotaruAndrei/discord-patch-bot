import type { GuildSettings, PriceAlertRule } from "../../types.js";

export const PRICE_ALERT_PREPARATION_POLICY = "Alertele de pret pot fi salvate inainte de /start reduceri si raman inactive pana cand modulul reduceri are un canal activ.";

export function isPriceAlertDeliveryActive(settings: GuildSettings | null | undefined): boolean {
  return settings?.discountsSubscribed === true && typeof settings.discountChannelId === "string" && settings.discountChannelId.length > 0;
}

export function formatPriceAlertActivationState(settings: GuildSettings | null | undefined, alert: PriceAlertRule): string {
  if (!isPriceAlertDeliveryActive(settings)) return "inactiva, asteapta /start reduceri";
  return alert.triggeredAt ? "declansata, asteapta rearmare" : "armata";
}
