"use strict";

import type { GameDlc } from "../command-handlers/dlcSourceService.js";
import type { NotificationEmbed } from "./notificationTypes.js";

export interface DlcGameRef {
  key: string;
  name: string;
  appId?: string | number | null;
}

export interface DlcCandidate {
  gameKey: string;
  gameName: string;
  appId: string;
  dlc: GameDlc;
}

const DEFAULT_DLC_EMBED_COLOR = 0x1b2838;

export function planDlcCandidates(
  games: DlcGameRef[],
  dlcsByGame: Map<string, GameDlc[]>,
  limit: number
): DlcCandidate[] {
  const candidates: DlcCandidate[] = [];
  for (const game of games) {
    if (candidates.length >= limit) break;
    const gameKey = String(game?.key ?? "").trim();
    if (!gameKey) continue;
    const dlcs = dlcsByGame.get(gameKey);
    if (!dlcs?.length) continue;
    const appId = String(game.appId ?? "").trim();
    const seenKeys = new Set<string>();
    for (const dlc of dlcs) {
      if (candidates.length >= limit) break;
      const dlcKey = String(dlc?.dlcKey ?? "").trim();
      const name = String(dlc?.name ?? "").trim();
      if (!dlcKey || !name || seenKeys.has(dlcKey)) continue;
      seenKeys.add(dlcKey);
      candidates.push({ gameKey, gameName: String(game.name ?? gameKey), appId, dlc: { dlcKey, name, price: dlc.price } });
    }
  }
  return candidates;
}

export function collectBaselineDlcEntries(
  games: DlcGameRef[],
  dlcsByGame: Map<string, GameDlc[]>
): Array<{ gameKey: string; dlcKey: string }> {
  const entries: Array<{ gameKey: string; dlcKey: string }> = [];
  for (const game of games) {
    const gameKey = String(game?.key ?? "").trim();
    if (!gameKey) continue;
    const dlcs = dlcsByGame.get(gameKey);
    if (!dlcs?.length) continue;
    for (const dlc of dlcs) {
      const dlcKey = String(dlc?.dlcKey ?? "").trim();
      if (dlcKey) entries.push({ gameKey, dlcKey });
    }
  }
  return entries;
}

export function buildDlcEmbed(candidate: DlcCandidate, color: number = DEFAULT_DLC_EMBED_COLOR): NotificationEmbed {
  const storeUrl = candidate.appId ? `https://store.steampowered.com/app/${candidate.appId}` : undefined;
  const priceLine = candidate.dlc.price ? `\nPret: ${candidate.dlc.price}` : "";
  return {
    title: `DLC nou: ${candidate.gameName}`,
    ...(storeUrl ? { url: storeUrl } : {}),
    description: `**${candidate.dlc.name}**${priceLine}`,
    color
  };
}
