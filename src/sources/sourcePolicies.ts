"use strict";

export type SourceFailMode = "fail-open" | "fail-closed";
export type SourceContentBudget = "html" | "json-large";

export interface SourceRequestPolicy {
  timeoutMs: number;
  contentBudget: SourceContentBudget;
  failMode: SourceFailMode;
  retries: number;
  retryDelayMs: number;
  viaProxy: boolean;
}

export const DEFAULT_SOURCE_TIMEOUT_MS = 15000;
export const DEFAULT_SOURCE_RETRIES = 2;
export const DEFAULT_SOURCE_RETRY_DELAY_MS = 1000;

function policy(overrides: Partial<SourceRequestPolicy> & Pick<SourceRequestPolicy, "contentBudget" | "failMode">): SourceRequestPolicy {
  return {
    timeoutMs: DEFAULT_SOURCE_TIMEOUT_MS,
    retries: DEFAULT_SOURCE_RETRIES,
    retryDelayMs: DEFAULT_SOURCE_RETRY_DELAY_MS,
    viaProxy: false,
    ...overrides
  };
}

export const SOURCE_POLICIES = {
  "steam-search": policy({ contentBudget: "json-large", failMode: "fail-closed" }),
  "steam-appdetails": policy({ contentBudget: "json-large", failMode: "fail-closed" }),
  "steam-players": policy({ contentBudget: "json-large", failMode: "fail-closed" }),
  "steam-news": policy({ contentBudget: "json-large", failMode: "fail-open", timeoutMs: 8000 }),
  "steam-offer-end-html": policy({ contentBudget: "html", failMode: "fail-open" }),
  "steam-reviews": policy({ contentBudget: "json-large", failMode: "fail-open", retries: 3, retryDelayMs: 800 }),
  "steam-featured-deals": policy({ contentBudget: "json-large", failMode: "fail-open" }),
  "epic-graphql-deals": policy({ contentBudget: "json-large", failMode: "fail-open" }),
  "deal-enrichment-appdetails": policy({ contentBudget: "json-large", failMode: "fail-open", timeoutMs: 5000 }),
  "deal-enrichment-store-html": policy({ contentBudget: "html", failMode: "fail-open" }),
  "listing-index": policy({ contentBudget: "html", failMode: "fail-closed" }),
  "listing-article": policy({ contentBudget: "html", failMode: "fail-open", timeoutMs: 8000 }),
  "platform-fortnite-blog": policy({ contentBudget: "html", failMode: "fail-open", viaProxy: true }),
  "platform-rss-fallback": policy({ contentBudget: "html", failMode: "fail-closed" }),
  "platform-minecraft-manifest": policy({ contentBudget: "json-large", failMode: "fail-open" }),
  "youtube-channel-page": policy({ contentBudget: "html", failMode: "fail-closed" }),
  "youtube-feed": policy({ contentBudget: "html", failMode: "fail-closed" }),
  "youtube-video-metadata": policy({ contentBudget: "html", failMode: "fail-closed" })
} as const satisfies Record<string, SourceRequestPolicy>;

export type SourcePolicyId = keyof typeof SOURCE_POLICIES;

export function requestOptionsFor(id: SourcePolicyId): { timeout: number; largeJson?: true } {
  const selected = SOURCE_POLICIES[id];
  return selected.contentBudget === "json-large"
    ? { timeout: selected.timeoutMs, largeJson: true }
    : { timeout: selected.timeoutMs };
}
