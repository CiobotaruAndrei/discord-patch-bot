import type { CurrencyCode } from "../../types";
import type { DealInfo, PatchUpdate } from "../../sources/sourceTypes";

export type NotificationMode = "compact" | "detailed";

export interface PendingUpdate extends PatchUpdate {
  id: string;
  attempts?: number;
  createdAt?: Date | string;
}

export interface PendingDiscount {
  hash: string;
  snapshot?: DealInfo | null;
  lastSeenAt?: Date | string;
  attempts?: number;
}

export interface LastErrorInfo {
  message?: string;
  channelId?: string | null;
  at?: Date | string | null;
}

export interface PriceAlertRule {
  gameKey: string;
  gameName: string;
  appId?: string;
  aliases?: string[];
  threshold: number;
  currency: CurrencyCode | string;
  triggeredAt?: Date | string | null;
  lastObservedPrice?: number | null;
  lastObservedAt?: Date | string | null;
  absentCycles?: number | null;
}

export interface DeadLetterEntry {
  kind: string;
  itemId: string;
  reason: string;
  at?: Date | string;
  attempts?: number;
}
