import type { CurrencyCode, ServerAuditLogEntry } from "../../types.js";
import { createOperationJournal, type OperationJournal, type OperationJournalModelLike } from "../../infra/mongo/operationJournal.js";
import { resetGuildConfigurationWithAudit, type GuildConfigWriteModelLike } from "../guild-config/guildConfigRepository.js";
import type { GuildAuditLogModelLike } from "./auditLogRepository.js";
import type { YoutubeErrorModelLike } from "../youtube/youtubeErrorsRepository.js";
import type { DeadLetterModelLike } from "../notifications/deadLetterRepository.js";

type JournalLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export const RESET_CONFIG_KIND = "reset-config";

export interface ResetConfigPayload {
  guildId: string;
  defaultCurrency: CurrencyCode;
  audit: Omit<ServerAuditLogEntry, "serverId" | "at">;
}

export interface OperationJournalRuntimeDeps {
  OperationJournalModel: OperationJournalModelLike;
  GuildModel: GuildConfigWriteModelLike;
  GuildAuditLogModel: GuildAuditLogModelLike;
  GuildYoutubeErrorModel: Pick<YoutubeErrorModelLike, "deleteMany">;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "deleteMany">;
  logger: JournalLogger;
}

function isResetConfigPayload(payload: unknown): payload is ResetConfigPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Record<string, unknown>;
  return typeof candidate.guildId === "string"
    && typeof candidate.defaultCurrency === "string"
    && Boolean(candidate.audit) && typeof candidate.audit === "object";
}

export function createOperationJournalRuntime(deps: OperationJournalRuntimeDeps): OperationJournal {
  const { OperationJournalModel, GuildModel, GuildAuditLogModel, GuildYoutubeErrorModel, GuildDeadLetterModel, logger } = deps;
  const executors = {
    [RESET_CONFIG_KIND]: async (payload: unknown): Promise<void> => {
      if (!isResetConfigPayload(payload)) {
        throw new Error(`operationJournal: payload invalid pentru operatia '${RESET_CONFIG_KIND}'`);
      }
      await resetGuildConfigurationWithAudit(
        GuildModel, GuildAuditLogModel, GuildYoutubeErrorModel, GuildDeadLetterModel,
        payload.guildId, payload.defaultCurrency, payload.audit, logger
      );
    }
  };
  return createOperationJournal({ JournalModel: OperationJournalModel, logger, executors });
}
