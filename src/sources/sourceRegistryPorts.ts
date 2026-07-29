"use strict";

export interface HttpResponseLike {
  data: unknown;
}

export interface HttpSourcePort {
  request(method: string, url: string, options?: Record<string, unknown>): Promise<HttpResponseLike>;
  maxHtmlBytes(): number;
  maxJsonBytes(): number;
  fetchConcurrency(): number;
}

export interface SteamSourcePort {
  currentPlayers(appId: string | number): Promise<unknown>;
  offerEndFromHtml(html: unknown): string | null;
}

export interface UpdatesSourcePort {
  stableUpdateId(title: string, link: string): string;
}

export interface DealsSourcePort {
  maxDeals(): number;
  sweepEnrichedCache(): void;
  enrichedCacheSize(): number;
}

export interface SourcePorts {
  http: HttpSourcePort;
  steam: SteamSourcePort;
  updates: UpdatesSourcePort;
  deals: DealsSourcePort;
}

export const SOURCE_PORT_NAMES = [
  "HttpSourcePort",
  "SteamSourcePort",
  "UpdatesSourcePort",
  "DealsSourcePort"
] as const;

export type SourcePortName = (typeof SOURCE_PORT_NAMES)[number];
