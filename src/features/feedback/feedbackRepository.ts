"use strict";

type WithMongoRetry = <T>(fn: () => Promise<T>, opts?: { label?: string; retries?: number }) => Promise<T>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface FeedbackReportModelLike {
  create(doc: ReportDoc): Promise<unknown>;
  find(filter: unknown, projection?: unknown): {
    sort(spec: unknown): { limit(count: number): { lean(): Promise<Array<Record<string, unknown>>> } };
  };
  findOneAndUpdate(filter: unknown, update: unknown, options: unknown): {
    lean(): Promise<Record<string, unknown> | null>;
  };
}

interface FeedbackRepositoryContext {
  FeedbackReportModel: FeedbackReportModelLike;
  withMongoRetry: WithMongoRetry;
  logger: Logger;
  recordFeedbackReport?: unknown;
  getRecentFeedbackReports?: unknown;
  resolveFeedbackReport?: unknown;
}

interface ReportInput {
  guildId: string;
  userId?: string;
  type?: string;
  gameKey?: string;
  detail?: string;
}

interface ReportDoc {
  id?: string;
  guildId: string;
  userId: string;
  type: string;
  gameKey: string;
  detail: string;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string;
}

interface ReportType {
  value: string;
  label: string;
}

const REPORT_TYPES: ReportType[] = [
  { value: "update-gresit", label: "Update gresit/inexact" },
  { value: "duplicat", label: "Notificare duplicata" },
  { value: "joc-lipsa", label: "Joc sau sursa lipsa" },
  { value: "sursa-stricata", label: "Sursa stricata (nu mai vin update-uri)" },
  { value: "altceva", label: "Altceva" }
];

function normalizeReportType(value: string | null | undefined): string {
  const found = REPORT_TYPES.find(type => type.value === value);
  return found ? found.value : "altceva";
}

function reportTypeLabel(value: string): string {
  const found = REPORT_TYPES.find(type => type.value === value);
  return found ? found.label : value;
}

function sanitizeReport(input: ReportInput, now: Date): ReportDoc {
  return {
    guildId: String(input.guildId || ""),
    userId: String(input.userId || "").slice(0, 40),
    type: normalizeReportType(input.type),
    gameKey: String(input.gameKey || "").slice(0, 100),
    detail: String(input.detail || "").slice(0, 1000),
    createdAt: now
  };
}

function stringifyMongoId(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { toString?: () => string }).toString === "function") {
    return String((value as { toString: () => string }).toString());
  }
  return "";
}

function isValidReportId(value: string): boolean {
  return /^[a-f0-9]{24}$/i.test(value);
}

interface FeedbackRepository {
  recordReport(input: ReportInput): Promise<ReportDoc>;
  getRecent(guildId: string, limit: number): Promise<ReportDoc[]>;
  resolveReport(guildId: string, reportId: string, resolvedBy: string): Promise<boolean>;
}

function createFeedbackRepository(deps: { FeedbackReportModel: FeedbackReportModelLike; withMongoRetry: WithMongoRetry; logger: Logger }): FeedbackRepository {
  const { FeedbackReportModel, withMongoRetry } = deps;

  async function recordReport(input: ReportInput): Promise<ReportDoc> {
    const doc = sanitizeReport(input, new Date());
    await withMongoRetry(() => FeedbackReportModel.create(doc), { label: "feedback:record", retries: 1 });
    return doc;
  }

  async function getRecent(guildId: string, limit: number): Promise<ReportDoc[]> {
    const safeLimit = Math.min(25, Math.max(1, Math.floor(limit) || 10));
    const docs = await withMongoRetry(
      () => FeedbackReportModel.find({ guildId }, { userId: 1, type: 1, gameKey: 1, detail: 1, createdAt: 1, resolvedAt: 1, resolvedBy: 1 }).sort({ createdAt: -1 }).limit(safeLimit).lean(),
      { label: "feedback:getRecent" }
    );
    return docs.map(raw => ({
      id: stringifyMongoId(raw._id),
      guildId,
      userId: String(raw.userId || ""),
      type: normalizeReportType(String(raw.type || "")),
      gameKey: String(raw.gameKey || ""),
      detail: String(raw.detail || ""),
      createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt)),
      resolvedAt: raw.resolvedAt ? (raw.resolvedAt instanceof Date ? raw.resolvedAt : new Date(String(raw.resolvedAt))) : null,
      resolvedBy: String(raw.resolvedBy || "")
    }));
  }

  async function resolveReport(guildId: string, reportId: string, resolvedBy: string): Promise<boolean> {
    if (!isValidReportId(reportId)) return false;
    const doc = await withMongoRetry(
      () => FeedbackReportModel.findOneAndUpdate(
        { _id: reportId, guildId },
        { $set: { resolvedAt: new Date(), resolvedBy: String(resolvedBy || "").slice(0, 40) } },
        { new: true }
      ).lean(),
      { label: "feedback:resolve" }
    );
    return doc !== null;
  }

  return { recordReport, getRecent, resolveReport };
}

type FeedbackInstaller = ((target: FeedbackRepositoryContext) => void) & {
  createFeedbackRepository: typeof createFeedbackRepository;
  sanitizeReport: typeof sanitizeReport;
  normalizeReportType: typeof normalizeReportType;
  reportTypeLabel: typeof reportTypeLabel;
  REPORT_TYPES: ReportType[];
};

const attachFeedbackRepository = ((target: FeedbackRepositoryContext): void => {
  const repository = createFeedbackRepository({
    FeedbackReportModel: target.FeedbackReportModel,
    withMongoRetry: target.withMongoRetry,
    logger: target.logger
  });
  Object.assign(target, {
    recordFeedbackReport: repository.recordReport,
    getRecentFeedbackReports: repository.getRecent,
    resolveFeedbackReport: repository.resolveReport
  });
}) as FeedbackInstaller;

attachFeedbackRepository.createFeedbackRepository = createFeedbackRepository;
attachFeedbackRepository.sanitizeReport = sanitizeReport;
attachFeedbackRepository.normalizeReportType = normalizeReportType;
attachFeedbackRepository.reportTypeLabel = reportTypeLabel;
attachFeedbackRepository.REPORT_TYPES = REPORT_TYPES;

export = attachFeedbackRepository;
