"use strict";

export interface PlayerCountSnapshot {
  appId: string;
  gameKey: string;
  playerCount: number;
  fetchedAt: Date;
}

export interface PlayerCountHistoryPoint extends PlayerCountSnapshot {}

export interface PlayerCountRecord {
  appId: string;
  gameKey: string;
  playerCount: number;
  reachedAt: Date;
}

export interface PlayerCountSnapshotLeanDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date | string;
}

export interface PlayerCountHistoryLeanDoc {
  appId?: string;
  gameKey?: string;
  playerCount?: number;
  fetchedAt?: Date | string;
}

export interface PlayerCountRecordLeanDoc {
  _id: string;
  gameKey?: string;
  playerCount?: number;
  reachedAt?: Date | string;
}

export interface PlayerCountSnapshotModelLike {
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): { lean(): Promise<PlayerCountSnapshotLeanDoc[]> };
}

export interface PlayerCountHistoryModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): { sort(spec: Record<string, 1 | -1>): { lean(): Promise<PlayerCountHistoryLeanDoc[]> } };
}

export interface PlayerCountRecordModelLike {
  findById(id: string): { lean(): Promise<PlayerCountRecordLeanDoc | null> };
  find(filter: Record<string, unknown>): { lean(): Promise<PlayerCountRecordLeanDoc[]> };
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface MilestoneGuildDoc {
  _id: string;
  playerCountChannelId?: string | null;
  enabledGames?: string[];
  playerCountSubscribed?: boolean;
}

export interface GuildModelLike {
  find(filter: Record<string, unknown>): { lean(): Promise<MilestoneGuildDoc[]> };
  updateOne?(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ modifiedCount?: number }>;
}

export interface SteamCurrentPlayersLike {
  appId: string;
  playerCount: number;
  success: boolean;
}

export type PlayerCountLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export function validDate(value: Date | string | undefined): Date | null {
  if (value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function validCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

export function sendableChannel(value: unknown): value is { send(payload: unknown): Promise<unknown> } {
  return Boolean(value) && typeof (value as { send?: unknown }).send === "function";
}
