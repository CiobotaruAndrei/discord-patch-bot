export interface ConfigBackupRecord {
  name: string;
  createdBy: string;
  createdAt: Date | string;
  snapshot: Record<string, unknown>;
}

export interface BotAuditLogEntry {
  userId: string;
  command: string;
  result: string;
  serverId: string;
  details?: string;
  at: Date | string;
}

export interface ServerAuditLogEntry {
  userId: string;
  actorId?: string;
  targetId?: string;
  action: string;
  serverId: string;
  details?: string;
  at: Date | string;
}

export interface SuggestedCommandEntry {
  commandName: string;
  description: string;
  createdBy: string;
  createdAt: Date | string;
}

export interface WatchlistGameSuggestionEntry {
  gameName: string;
  createdBy: string;
  createdAt: Date | string;
}

export interface FutureReleaseGameEntry {
  gameName: string;
  addedBy: string;
  addedAt: Date | string;
  releaseDate?: string;
  preorderPrice?: string;
  sourceAppId?: string;
  baselineDone?: boolean;
  notifiedThresholdDays?: number[];
  preorderSeen?: boolean;
  observedPreorderPrice?: string | null;
  stateRevision?: number;
  lastCheckedAt?: Date | string | null;
}
