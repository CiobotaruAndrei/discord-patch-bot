import type { DocumentCollection, MongoPorts } from "../../infra/mongo/mongoPorts.js";
import type { SourcePorts } from "../../sources/sourceRegistryPorts.js";
import type { RuntimePorts } from "../../app/appRuntimeContracts.js";

function inertCollection(): DocumentCollection {
  return {
    async updateOne() { return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }; },
    async countDocuments() { return 0; }
  };
}

export function stubMongoPorts(overrides: Partial<MongoPorts> = {}): MongoPorts {
  return {
    guildConfig: {
      guilds: inertCollection(),
      async readSettings() { return null; },
      invalidate() { return undefined; },
      sweepExpired() { return undefined; },
      cachedCount() { return 0; }
    },
    notifications: {
      outbox: inertCollection(),
      outboxSent: inertCollection(),
      history: inertCollection(),
      deadLetters: inertCollection(),
      deadLetterReplays: inertCollection(),
      seenDiscounts: inertCollection(),
      seenUpdates: inertCollection(),
      seenDlcs: inertCollection(),
      seenYoutube: inertCollection()
    },
    security: {
      newAccountAlerts: inertCollection(),
      channelLockRecoveries: inertCollection(),
      youtubeErrors: inertCollection()
    },
    audit: {
      auditLog: inertCollection(),
      configBackups: inertCollection(),
      suggestedCommands: inertCollection()
    },
    operations: {
      journal: inertCollection(),
      jobLocks: inertCollection(),
      async acquire() { return null; },
      async renew() { return false; },
      async release() { return undefined; }
    },
    ...overrides
  };
}

export function stubSourcePorts(overrides: Partial<SourcePorts> = {}): SourcePorts {
  return {
    http: {
      async request() { return { data: null }; },
      maxHtmlBytes() { return 0; },
      maxJsonBytes() { return 0; },
      fetchConcurrency() { return 1; }
    },
    steam: {
      async currentPlayers() { return null; },
      offerEndFromHtml() { return null; }
    },
    updates: {
      stableUpdateId() { return ""; }
    },
    deals: {
      maxDeals() { return 0; },
      sweepEnrichedCache() { return undefined; },
      enrichedCacheSize() { return 0; }
    },
    ...overrides
  };
}

export function stubRuntimePorts(overrides: Partial<RuntimePorts> = {}): RuntimePorts {
  return { mongo: stubMongoPorts(), sources: stubSourcePorts(), ...overrides };
}
