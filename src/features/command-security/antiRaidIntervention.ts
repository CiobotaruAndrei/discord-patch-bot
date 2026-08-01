"use strict";

import { createRaidIncidentRepository } from "./antiRaidIncidentRepository.js";
import {
  lockdownOverdue,
  nextSanctionStep,
  participantSettled,
  safetyPeriodElapsed
} from "./antiRaidIncidentTypes.js";

import type { RaidIncidentModelLike } from "./antiRaidIncidentRepository.js";
import type { RaidIncidentRecord, SanctionStep } from "./antiRaidIncidentTypes.js";
import type { AntiRaidThresholds } from "./antiRaidThresholds.js";

export interface SanctionOutcome {
  applied: boolean;
  retryable: boolean;
  error: string | null;
}

export interface RaidGuildPort {
  id: string;
  lockChannel(channelId: string): Promise<{ locked: boolean; previousSendMessages: boolean | null }>;
  unlockChannel(channelId: string, previousSendMessages: boolean | null): Promise<boolean>;
  applySanction(userId: string, step: SanctionStep, durationMs: number, reason: string): Promise<SanctionOutcome>;
  purgeMessages(channelIds: readonly string[], userIds: readonly string[]): Promise<number>;
  publish(body: string): Promise<unknown>;
  alertOwner(body: string): Promise<unknown>;
}

export interface InterventionDeps {
  RaidIncidentModel: RaidIncidentModelLike;
  thresholds: (guildId: string) => Promise<AntiRaidThresholds>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  retryAttempts?: number;
  retryDelayMs?: number;
}

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

export type InterventionStep =
  | { kind: "no-incident" }
  | { kind: "dry-run"; incidentId: string; wouldLock: string[]; wouldSanction: string[] }
  | { kind: "locked"; incidentId: string; channelIds: string[] }
  | { kind: "sanctioned"; incidentId: string; userId: string; step: SanctionStep; applied: boolean }
  | { kind: "escalation-exhausted"; incidentId: string; userId: string }
  | { kind: "cleaned"; incidentId: string; deleted: number }
  | { kind: "restored"; incidentId: string; channelIds: string[] }
  | { kind: "waiting"; incidentId: string; remainingMs: number }
  | { kind: "lockdown-overdue"; incidentId: string };

export function createRaidIntervention(deps: InterventionDeps) {
  const incidents = createRaidIncidentRepository(deps.RaidIncidentModel);
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? (async (ms: number) => { await new Promise(resolve => setTimeout(resolve, ms)); });
  const retryAttempts = deps.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS;
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  async function sanctionWithRetry(
    guild: RaidGuildPort,
    userId: string,
    step: SanctionStep,
    durationMs: number,
    reason: string
  ): Promise<SanctionOutcome> {
    let last: SanctionOutcome = { applied: false, retryable: false, error: "nicio incercare" };
    for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
      last = await guild.applySanction(userId, step, durationMs, reason).catch(error => ({
        applied: false,
        retryable: false,
        error: error instanceof Error ? error.message : String(error)
      }));
      if (last.applied || !last.retryable) return last;
      await wait(retryDelayMs * (attempt + 1));
    }
    return last;
  }

  async function lockAffectedChannels(
    guild: RaidGuildPort,
    incident: RaidIncidentRecord,
    channelIds: readonly string[]
  ): Promise<InterventionStep> {
    const locked: string[] = [];
    for (const channelId of channelIds) {
      if (incident.lockedChannels.some(entry => entry.channelId === channelId && !entry.restoredAt)) continue;
      const outcome = await guild.lockChannel(channelId).catch(() => ({ locked: false, previousSendMessages: null }));
      if (!outcome.locked) {
        await incidents.recordError(incident._id, `Lockdown esuat pentru canalul ${channelId}`, new Date(now()));
        continue;
      }
      await incidents.lockChannel(incident._id, channelId, outcome.previousSendMessages, new Date(now()));
      locked.push(channelId);
    }
    return { kind: "locked", incidentId: incident._id, channelIds: locked };
  }

  async function sanctionParticipants(
    guild: RaidGuildPort,
    incident: RaidIncidentRecord,
    thresholds: AntiRaidThresholds
  ): Promise<InterventionStep[]> {
    const steps: InterventionStep[] = [];
    for (const participant of incident.participants) {
      if (participantSettled(participant)) continue;
      const step = nextSanctionStep(participant);
      if (!step) continue;

      const durationMs = step === "mute"
        ? thresholds.muteDurationMs
        : step === "timeout" ? thresholds.timeoutDurationMs : 0;
      const outcome = await sanctionWithRetry(
        guild,
        participant.userId,
        step,
        durationMs,
        `Anti-raid ${incident._id}: participare confirmata la atac`
      );
      await incidents.recordSanction(incident._id, participant.userId, step, outcome.applied, outcome.error, new Date(now()));
      steps.push({ kind: "sanctioned", incidentId: incident._id, userId: participant.userId, step, applied: outcome.applied });

      if (!outcome.applied) {
        const remaining = nextSanctionStep({
          bot: participant.bot,
          appliedSteps: participant.appliedSteps,
          failedSteps: [...participant.failedSteps, step]
        });
        if (!remaining) {
          await incidents.markParticipantFailed(
            incident._id,
            participant.userId,
            outcome.error ?? "toate treptele au esuat",
            new Date(now())
          );
          await guild.alertOwner(
            `Anti-raid ${incident._id}: participantul <@${participant.userId}> nu a putut fi oprit (mute, timeout si ban au esuat). Lockdown-ul ramane activ; e nevoie de interventie manuala.`
          );
          steps.push({ kind: "escalation-exhausted", incidentId: incident._id, userId: participant.userId });
        }
      }
    }
    return steps;
  }

  async function restore(guild: RaidGuildPort, incident: RaidIncidentRecord): Promise<InterventionStep> {
    const restored: string[] = [];
    const pending = incident.lockedChannels.filter(entry => !entry.restoredAt);
    for (const [index, entry] of pending.entries()) {
      const done = await guild.unlockChannel(entry.channelId, entry.previousSendMessages).catch(() => false);
      if (done) {
        await incidents.markChannelRestored(incident._id, entry.channelId, new Date(now()));
        restored.push(entry.channelId);
      } else {
        await incidents.recordError(incident._id, `Restaurarea canalului ${entry.channelId} a esuat`, new Date(now()));
      }
      await incidents.setRestoreProgress(incident._id, ((index + 1) / pending.length) * 100);
    }
    if (pending.length === 0) await incidents.setRestoreProgress(incident._id, 100);
    return { kind: "restored", incidentId: incident._id, channelIds: restored };
  }

  async function advanceIncident(guild: RaidGuildPort, channelIds: readonly string[] = []): Promise<InterventionStep[]> {
    const incident = await incidents.active(guild.id);
    if (!incident) return [{ kind: "no-incident" }];

    const thresholds = await deps.thresholds(guild.id);
    const moment = now();

    if (incident.dryRun) {
      return [{
        kind: "dry-run",
        incidentId: incident._id,
        wouldLock: [...channelIds],
        wouldSanction: incident.participants.filter(entry => !participantSettled(entry)).map(entry => entry.userId)
      }];
    }

    const steps: InterventionStep[] = [];

    if (incident.stage === "suspected") {
      await incidents.advance(incident._id, "suspected", "confirmed", new Date(moment));
      await guild.publish(`Anti-raid ${incident._id}: raid confirmat. Motiv: ${incident.triggerReason}.`);
    }

    const current = await incidents.read(incident._id);
    if (!current) return steps;

    if (current.stage === "confirmed" || current.stage === "containment") {
      if (current.stage === "confirmed") await incidents.advance(current._id, "confirmed", "containment", new Date(moment));
      steps.push(await lockAffectedChannels(guild, current, channelIds));
      steps.push(...await sanctionParticipants(guild, current, thresholds));

      if (lockdownOverdue(current, thresholds.maxLockdownMs, moment)) {
        await guild.alertOwner(
          `Anti-raid ${current._id}: lockdown-ul dureaza de peste ${Math.round(thresholds.maxLockdownMs / 60_000)} de minute. E nevoie de decizia ownerului: /anti-raid force-stop confirm:true sau prelungire.`
        );
        steps.push({ kind: "lockdown-overdue", incidentId: current._id });
      }
      return steps;
    }

    if (current.stage === "cleanup") {
      const settled = current.participants.filter(entry => participantSettled(entry)).map(entry => entry.userId);
      const deleted = await guild
        .purgeMessages(current.lockedChannels.map(entry => entry.channelId), settled)
        .catch(() => 0);
      await incidents.advance(current._id, "cleanup", "recovery", new Date(moment));
      steps.push({ kind: "cleaned", incidentId: current._id, deleted });
      return steps;
    }

    if (current.stage === "recovery") {
      if (!safetyPeriodElapsed(current, thresholds.safetyPeriodMs, moment)) {
        const remainingMs = thresholds.safetyPeriodMs - (moment - new Date(current.lastActivityAt).getTime());
        return [{ kind: "waiting", incidentId: current._id, remainingMs }];
      }
      steps.push(await restore(guild, current));
      await incidents.advance(current._id, "recovery", "resolved", new Date(moment));
      await guild.publish(
        `Anti-raid ${current._id}: incident inchis. Lockdown-ul a fost ridicat, iar mute-urile, timeout-urile, banurile si eliminarile de roluri raman aplicate.`
      );
      return steps;
    }

    return steps;
  }

  async function markContained(guildId: string): Promise<boolean> {
    const incident = await incidents.active(guildId);
    if (!incident || incident.stage !== "containment") return false;
    const unsettled = incident.participants.filter(entry => !participantSettled(entry));
    if (unsettled.length > 0) return false;
    return incidents.advance(incident._id, "containment", "cleanup", new Date(now()));
  }

  return { advanceIncident, markContained, sanctionWithRetry, restore };
}

export type RaidIntervention = ReturnType<typeof createRaidIntervention>;
