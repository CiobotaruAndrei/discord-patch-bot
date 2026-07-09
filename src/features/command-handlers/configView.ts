"use strict";

import type { CurrencyCode, GameConfig, GuildSettings, NotificationMode } from "../../types";
import { clampJoinedList } from "../command-presentation/discordListLimit";

export interface ConfigEmbed {
  title: string;
  description: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
}

function onOff(value: boolean | undefined, fallback: boolean): string {
  return (value ?? fallback) ? "on" : "off";
}

function formatChannel(id: string | null | undefined, active: boolean | undefined): string {
  const target = id ? `<#${id}>` : "neconfigurat";
  return active ? target : `${target} (oprit)`;
}

function formatRole(id: string | null | undefined): string {
  return id ? `<@&${id}>` : "neconfigurat";
}

function formatAdminAlertChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : "oprit";
}

function formatGames(settings: GuildSettings | null, games: GameConfig[]): string {
  const enabled = Array.isArray(settings?.enabledGames) ? settings.enabledGames : [];
  if (!enabled.length) return "toate jocurile configurate";
  const byKey = new Map(games.map(game => [String(game.key).toLowerCase(), game]));
  const items = enabled.map(key => {
    const game = byKey.get(String(key).toLowerCase());
    return game ? `${game.name} (${game.key})` : String(key);
  });
  return clampJoinedList(items, 1024, { separator: ", " });
}

function formatStores(settings: GuildSettings | null): string {
  const stores = Array.isArray(settings?.enabledStores) ? settings.enabledStores : [];
  return stores.length ? stores.join(", ") : "toate magazinele";
}

export function buildConfigEmbed(settings: GuildSettings | null, games: GameConfig[], defaultCurrency: CurrencyCode): ConfigEmbed {
  const mode: NotificationMode = settings?.notificationMode === "compact" ? "compact" : "detailed";
  const minDiscount = Number.isFinite(settings?.minDiscountPercent) ? Number(settings?.minDiscountPercent) : 70;
  const maxPrice = Number.isFinite(settings?.maxAbsolutePrice) ? Number(settings?.maxAbsolutePrice) : 0;
  const currency = String(settings?.currency || defaultCurrency);

  return {
    title: "Configuratie server",
    description: "Setarile active pentru notificari, reduceri, roluri si canale.",
    color: 0x3498db,
    fields: [
      {
        name: "Afisare si filtre",
        value: [
          `mode: ${mode}`,
          `mindiscount: ${minDiscount}%`,
          `maxprice: ${maxPrice > 0 ? maxPrice : "fara limita"}`,
          `free: ${onOff(settings?.includeFreeGames, true)}`,
          `paid: ${onOff(settings?.includePaidDiscounts, true)}`,
          `currency: ${currency}`,
          `stores: ${formatStores(settings)}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Jocuri",
        value: formatGames(settings, games),
        inline: false
      },
      {
        name: "Roluri si canale",
        value: [
          `rol update: ${formatRole(settings?.notificationRoleId)}`,
          `rol reduceri: ${formatRole(settings?.discountRoleId)}`,
          `canal update: ${formatChannel(settings?.notificationChannelId, settings?.subscribed)}`,
          `canal reduceri: ${formatChannel(settings?.discountChannelId, settings?.discountsSubscribed)}`,
          `canal YouTube: ${formatChannel(settings?.youtubeNotificationChannelId, settings?.youtubeNotificationsEnabled)}`,
          `canal future-release: ${formatChannel(settings?.futureReleaseChannelId, settings?.futureReleaseSubscribed)}`,
          `canal DLC automat: ${formatChannel(settings?.dlcChannelId, settings?.dlcSubscribed)}`,
          `canal alerte admin: ${formatAdminAlertChannel(settings?.adminAlertChannelId)}`
        ].join("\n"),
        inline: false
      },
      {
        name: "Alerte de pret",
        value: `${Array.isArray(settings?.priceAlerts) ? settings.priceAlerts.length : 0} configurate`,
        inline: false
      },
      {
        name: "Liste propuse",
        value: [
          `${Array.isArray(settings?.watchlistGameSuggestions) ? settings.watchlistGameSuggestions.length : 0} jocuri propuse pentru watchlist`,
          `${Array.isArray(settings?.futureReleaseGames) ? settings.futureReleaseGames.length : 0} jocuri future-release`
        ].join("\n"),
        inline: false
      },
      {
        name: "YouTube",
        value: [
          `${Array.isArray(settings?.youtubeChannels) ? settings.youtubeChannels.length : 0} canale urmarite`,
          `${Array.isArray(settings?.youtubeChannelRoutes) ? settings.youtubeChannelRoutes.reduce((total, route) => total + route.discordChannelIds.length, 0) : 0} rute speciale`,
          `${Array.isArray(settings?.youtubeTitleIncludeWords) ? settings.youtubeTitleIncludeWords.length : 0} filtre de titlu`,
          `sablon mesaj: ${settings?.youtubeMessageTemplate ? "personalizat" : "implicit"}`
        ].join("\n"),
        inline: false
      }
    ]
  };
}
