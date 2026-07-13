export interface CircuitBreakerDoc {
  _id: string;
  fails?: number;
  cooldownUntil?: Date | null;
  alertSent?: boolean;
  schemaDriftFails?: number;
  schemaDriftAlertSent?: boolean;
}

export interface SystemDoc {
  _id: string;
  executionTimes?: {
    all?: number;
    single?: number;
    reduceri?: number;
  };
  outboxPaused?: boolean;
}

export interface JobLockDoc {
  _id: string;
  lockedUntil?: Date | null;
  ownerToken?: string | null;
}

export interface AdminAlertCooldownDoc {
  _id: string;
  lastSentAt?: Date;
}

export interface FetchSnapshotDoc {
  _id: string;
  payload?: unknown;
  fetchedAt?: Date;
}

export interface PlayerCountSnapshotDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date;
}

export interface PlayerCountHistoryDoc {
  appId: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date;
}

export interface PlayerCountRecordDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  reachedAt?: Date;
}

export interface BugReportDoc {
  guildId: string;
  reportType: string;
  gameKey: string;
  description: string;
  authorId: string;
  dedupeKey: string;
  createdAt?: Date;
}

export interface UserComplaintDoc {
  guildId: string;
  reporterId: string;
  targetId: string;
  reason: string;
  dedupeKey: string;
  createdAt?: Date;
}

export interface FeedbackReportDoc {
  guildId: string;
  userId?: string;
  type: string;
  gameKey?: string;
  detail?: string;
  createdAt?: Date;
}
