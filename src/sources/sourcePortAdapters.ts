"use strict";

import type { SourceRegistryApi } from "./sourceRegistryFactory.js";
import type {
  DealsSourcePort,
  HttpSourcePort,
  SourcePorts,
  SteamSourcePort,
  UpdatesSourcePort
} from "./sourceRegistryPorts.js";

export function createHttpSourcePort(registry: SourceRegistryApi): HttpSourcePort {
  return {
    request: (method, url, options) => registry.httpReq(method, url, options),
    maxHtmlBytes: () => registry.MAX_HTML_BYTES,
    maxJsonBytes: () => registry.MAX_JSON_BYTES,
    fetchConcurrency: () => registry.FETCH_CONCURRENCY
  };
}

export function createSteamSourcePort(registry: SourceRegistryApi): SteamSourcePort {
  return {
    currentPlayers: appId => registry.fetchSteamCurrentPlayers(appId),
    offerEndFromHtml: html => registry.extractOfferEndFromHtml(html)
  };
}

export function createUpdatesSourcePort(registry: SourceRegistryApi): UpdatesSourcePort {
  return {
    stableUpdateId: (title, link) => registry.stableUpdateId(title, link)
  };
}

export function createDealsSourcePort(registry: SourceRegistryApi): DealsSourcePort {
  return {
    maxDeals: () => registry.MAX_DEALS,
    sweepEnrichedCache: () => registry.cleanEnrichedCache(),
    enrichedCacheSize: () => registry.getEnrichedCacheSize()
  };
}

export function createSourcePorts(registry: SourceRegistryApi): SourcePorts {
  return {
    http: createHttpSourcePort(registry),
    steam: createSteamSourcePort(registry),
    updates: createUpdatesSourcePort(registry),
    deals: createDealsSourcePort(registry)
  };
}
