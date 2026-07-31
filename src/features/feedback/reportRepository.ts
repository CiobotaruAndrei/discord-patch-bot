"use strict";

import { createHash } from "node:crypto";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

export interface BugReportRecord {
  id: string;
  guildId: string;
  reportType: string;
  gameKey: string;
  description: string;
  authorId: string;
  createdAt: Date;
}

export interface UserComplaintRecord {
  id: string;
  guildId: string;
  reporterId: string;
  targetId: string;
  reason: string;
  createdAt: Date;
}

type LeanRecord = Record<string, unknown>;

interface FindOneQuery {
  lean(): Promise<LeanRecord | null>;
}

interface FindManyQuery {
  sort(spec: Record<string, 1 | -1>): { limit(value: number): { lean(): Promise<LeanRecord[]> } };
}

interface ReportModelLike {
  create(doc: Record<string, unknown>): Promise<unknown>;
  findOne(filter: Record<string, unknown>): FindOneQuery;
  find(filter: Record<string, unknown>): FindManyQuery;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
}

interface ReportRepositoryDeps {
  BugReportModel: ReportModelLike;
  UserComplaintModel: ReportModelLike;
  withMongoRetry<T>(fn: () => Promise<T>, options?: { label?: string; retries?: number }): Promise<T>;
}

export type SaveReportResult<T> = { created: true; record: T } | { created: false; record: T };

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function dedupeKey(parts: readonly string[]): string {
  return createHash("sha256").update(parts.map(part => part.toLocaleLowerCase("ro-RO")).join("\u0000")).digest("hex");
}

function idOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const id = Reflect.get(value, "_id");
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && typeof Reflect.get(id, "toString") === "function") return String(id);
  return "";
}

function dateOf(value: unknown): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function bugFrom(value: LeanRecord, guildId: string): BugReportRecord {
  return {
    id: idOf(value),
    guildId,
    reportType: normalizeText(value.reportType, 100),
    gameKey: normalizeText(value.gameKey, 100),
    description: normalizeText(value.description, 1000),
    authorId: normalizeText(value.authorId, 40),
    createdAt: dateOf(value.createdAt)
  };
}

function complaintFrom(value: LeanRecord, guildId: string): UserComplaintRecord {
  return {
    id: idOf(value),
    guildId,
    reporterId: normalizeText(value.reporterId, 40),
    targetId: normalizeText(value.targetId, 40),
    reason: normalizeText(value.reason, 1000),
    createdAt: dateOf(value.createdAt)
  };
}

function duplicateKeyError(error: unknown): boolean {
  return Number((error as { code?: unknown } | null)?.code) === 11000;
}

export function createReportRepository(deps: ReportRepositoryDeps) {
  const { BugReportModel, UserComplaintModel, withMongoRetry } = deps;

  async function saveBug(input: { guildId: string; reportType: string; gameKey: string; description: string; authorId: string }): Promise<SaveReportResult<BugReportRecord>> {
    const guildId = normalizeText(input.guildId, 40);
    const reportType = normalizeText(input.reportType, 100);
    const gameKey = normalizeText(input.gameKey, 100);
    const description = normalizeText(input.description, 1000);
    const authorId = normalizeText(input.authorId, 40);
    const key = dedupeKey([reportType, gameKey, description]);
    const existing = await withMongoRetry(() => BugReportModel.findOne({ guildId, dedupeKey: key }).lean(), { label: "report:bug:duplicate" });
    if (existing) return { created: false, record: bugFrom(existing, guildId) };
    const createdAt = new Date();
    try {
      const created = await withMongoRetry(() => BugReportModel.create({ guildId, reportType, gameKey, description, authorId, dedupeKey: key, createdAt }), { label: "report:bug:create", retries: 1 });
      const record = bugFrom({ _id: idOf(created), guildId, reportType, gameKey, description, authorId, createdAt }, guildId);
      return { created: true, record };
    } catch (error: unknown) {
      if (!duplicateKeyError(error)) throw error;
      const raced = await BugReportModel.findOne({ guildId, dedupeKey: key }).lean();
      if (!raced) throw error;
      return { created: false, record: bugFrom(raced, guildId) };
    }
  }

  async function saveComplaint(input: { guildId: string; reporterId: string; targetId: string; reason: string }): Promise<SaveReportResult<UserComplaintRecord>> {
    const guildId = normalizeText(input.guildId, 40);
    const reporterId = normalizeText(input.reporterId, 40);
    const targetId = normalizeText(input.targetId, 40);
    const reason = normalizeText(input.reason, 1000);
    const key = dedupeKey([targetId, reason]);
    const existing = await withMongoRetry(() => UserComplaintModel.findOne({ guildId, dedupeKey: key }).lean(), { label: "report:complaint:duplicate" });
    if (existing) return { created: false, record: complaintFrom(existing, guildId) };
    const createdAt = new Date();
    try {
      const created = await withMongoRetry(() => UserComplaintModel.create({ guildId, reporterId, targetId, reason, dedupeKey: key, createdAt }), { label: "report:complaint:create", retries: 1 });
      const record = complaintFrom({ _id: idOf(created), guildId, reporterId, targetId, reason, createdAt }, guildId);
      return { created: true, record };
    } catch (error: unknown) {
      if (!duplicateKeyError(error)) throw error;
      const raced = await UserComplaintModel.findOne({ guildId, dedupeKey: key }).lean();
      if (!raced) throw error;
      return { created: false, record: complaintFrom(raced, guildId) };
    }
  }

  async function listBugs(guildId: string): Promise<BugReportRecord[]> {
    const normalizedGuildId = normalizeText(guildId, 40);
    const docs = await withMongoRetry(() => BugReportModel.find({ guildId: normalizedGuildId }).sort({ createdAt: -1 }).limit(500).lean(), { label: "report:bug:list" });
    return docs.map(doc => bugFrom(doc, normalizedGuildId));
  }

  async function listComplaints(guildId: string): Promise<UserComplaintRecord[]> {
    const normalizedGuildId = normalizeText(guildId, 40);
    const docs = await withMongoRetry(() => UserComplaintModel.find({ guildId: normalizedGuildId }).sort({ createdAt: -1 }).limit(500).lean(), { label: "report:complaint:list" });
    return docs.map(doc => complaintFrom(doc, normalizedGuildId));
  }

  async function removeBug(guildId: string, id: string): Promise<boolean> {
    const result = await withMongoRetry(() => BugReportModel.deleteOne({ _id: normalizeText(id, 100), guildId: normalizeText(guildId, 40) }), { label: "report:bug:remove" });
    return Number(result.deletedCount || 0) > 0;
  }

  async function removeComplaint(guildId: string, id: string): Promise<boolean> {
    const result = await withMongoRetry(() => UserComplaintModel.deleteOne({ _id: normalizeText(id, 100), guildId: normalizeText(guildId, 40) }), { label: "report:complaint:remove" });
    return Number(result.deletedCount || 0) > 0;
  }

  return { saveBug, saveComplaint, listBugs, listComplaints, removeBug, removeComplaint };
}

export const REPORT_REPOSITORY_KEYS = [
  "BugReportModel",
  "UserComplaintModel",
  "withMongoRetry"
] as const;

type ReportRepositoryKeyCheckDeps = Parameters<typeof createReportRepository>[0];
type ReportRepositoryMissing = MissingDependencyKeys<ReportRepositoryKeyCheckDeps, (typeof REPORT_REPOSITORY_KEYS)[number] & string>;
type ReportRepositoryExtra = ExtraDependencyKeys<ReportRepositoryKeyCheckDeps, (typeof REPORT_REPOSITORY_KEYS)[number] & string>;
const reportrepositoryKeysComplete: ExactDependencyKeys<Exclude<Extract<keyof ReportRepositoryKeyCheckDeps, string>, (typeof REPORT_REPOSITORY_KEYS)[number] & string>, ReportRepositoryExtra> = true;
