"use strict";

import type { CheerioAPI } from "cheerio";

type CheerioSelector = Parameters<CheerioAPI>[0];

export type DlcRow = { id: string; name: string; price: string };

export function dlcPageHasAgeGate($: CheerioAPI): boolean {
  return $("#agegate_box").length > 0 || $(".agegate_text_container").length > 0;
}

export function parseDlcRows($: CheerioAPI): DlcRow[] {
  const dlcList: DlcRow[] = [];
  const seenDlcIds = new Set<string>();
  $(".game_area_dlc_row").each((_i: number, el: unknown) => {
    const node = el as CheerioSelector;
    const dlcName = $(node).find(".game_area_dlc_name").text().trim();
    let dlcPrice = $(node).find(".game_area_dlc_price").text().trim().replace(/\s+/g, " ");
    const dlcAppId = String($(node).attr("data-ds-appid") || dlcName);
    if (!dlcPrice) dlcPrice = "Pret indisponibil";
    if (dlcName && !seenDlcIds.has(dlcAppId)) {
      seenDlcIds.add(dlcAppId);
      dlcList.push({ id: dlcAppId, name: dlcName, price: dlcPrice });
    }
  });
  return dlcList;
}

export function dlcPageLooksLikeStorePage($: CheerioAPI): boolean {
  return $(".game_area_purchase_game").length > 0;
}
