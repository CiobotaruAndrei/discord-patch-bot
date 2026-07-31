"use strict";

import { recordBotObservationEvent } from "./botObservationRepository.js";
import type { PermissionDelegationRuntimeDeps, AuditMatch, AuditEntryId, RecordedObservationEvent } from "./permissionDelegationContext.js";

export function createSensitiveActionObserver(deps: PermissionDelegationRuntimeDeps) {
  const processedAuditEntries = new Set<AuditEntryId>();

  async function observeSensitiveAction(
    guildId: string,
    actorId: string | null,
    match: AuditMatch,
    kind: string,
    at: number
  ): Promise<RecordedObservationEvent | null> {
    if (!deps.GuildModel || !actorId || match.entryId === null) return null;
    const observation = await recordBotObservationEvent(deps.GuildModel, guildId, actorId, {
      key: `audit:${String(match.entryId)}`,
      kind,
      at: new Date(at),
      confirmed: true
    });
    if (observation.burstStarted) {
      await deps.adminAlert(
        "security:bot-observation-burst",
        "Rafala de activitate sensibila a unui bot monitorizat",
        `Bot ${actorId}; ${observation.recentCount} actiuni corelate precis prin Audit Log intr-un minut; verificare owner urgenta`,
        guildId
      );
    }
    return observation;
  }

  function shouldSendIndividualAlert(observation: RecordedObservationEvent | null): boolean {
    return !observation?.observed || observation.recentCount === 1;
  }

  function markProcessed(match: AuditMatch): void {
    if (match.entryId !== null) processedAuditEntries.add(match.entryId);
  }

  return { observeSensitiveAction, shouldSendIndividualAlert, markProcessed, processedAuditEntries };
}

export type SensitiveActionObserver = ReturnType<typeof createSensitiveActionObserver>;
