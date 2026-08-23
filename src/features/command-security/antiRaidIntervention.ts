"use strict";

import { createRaidIncidentRepository } from "./antiRaidIncidentRepository.js";
import {
  lockdownOverdue,
  nextSanctionStep,
  participantSettled,
  coordinatedRaid,
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

export interface PurgeOutcome {
  deleted: number;
  unreachable: number;
}

export interface RaidGuildPort {
  id: string;
  lockChannel(channelId: string): Promise<{ locked: boolean; previousSendMessages: boolean | null }>;
  unlockChannel(channelId: string, previousSendMessages: boolean | null): Promise<boolean>;
  applySanction(userId: string, step: SanctionStep, durationMs: number, reason: string): Promise<SanctionOutcome>;
  purgeMessages(
    channelIds: readonly string[],
    userIds: readonly string[],
    webhookIds: readonly string[],
    since: number
  ): Promise<PurgeOutcome>;
  publish(body: string): Promise<unknown>;
  alertOwner(body: string): Promise<unknown>;
  findBotAdder?(botId: string): Promise<string | null>;
  stripElevatedRoles?(userId: string, reason: string): Promise<{ removed: string[]; blocked: string[] }>;
  captureStructureSnapshot?(incidentId: string): Promise<unknown>;
  restoreStructure?(incidentId: string): Promise<{ complete: boolean; blocked: number }>;
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
  | { kind: "dry-run-finished"; incidentId: string; closed: number }
  | { kind: "locked"; incidentId: string; channelIds: string[] }
  | { kind: "sanctioned"; incidentId: string; userId: string; step: SanctionStep; applied: boolean }
  | { kind: "escalation-exhausted"; incidentId: string; userId: string }
  | { kind: "cleaned"; incidentId: string; deleted: number; unreachable: number }
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
    const unrecorded: string[] = [];
    for (const channelId of channelIds) {
      if (incident.lockedChannels.some(entry => entry.channelId === channelId && !entry.restoredAt)) continue;
      const outcome = await guild.lockChannel(channelId).catch(() => ({ locked: false, previousSendMessages: null }));
      if (!outcome.locked) {
        await incidents
          .recordError(incident._id, `Lockdown esuat pentru canalul ${channelId}`, new Date(now()))
          .catch(() => false);
        continue;
      }
      const recorded = await incidents
        .lockChannel(incident._id, channelId, outcome.previousSendMessages, new Date(now()))
        .then(() => true, () => false);
      if (!recorded) unrecorded.push(channelId);
      locked.push(channelId);
    }

    if (unrecorded.length > 0) {
      await guild.alertOwner(
        `Anti-raid ${incident._id}: canalele ${unrecorded.join(", ")} au fost blocate, dar starea lor dinainte NU a putut fi salvata. Deblocarea automata la final nu le va acoperi; verificare manuala necesara.`
      ).catch(() => undefined);
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
      if (safetyPeriodElapsed(incident, thresholds.safetyPeriodMs, moment)) {
        const closed = await incidents.resolveDryRuns(guild.id, new Date(moment));
        await guild.publish(
          `Anti-raid ${incident._id}: simularea s-a incheiat dupa perioada de siguranta si a fost inchisa. Nicio actiune reala nu a fost aplicata.`
        );
        return [{ kind: "dry-run-finished", incidentId: incident._id, closed: closed.length }];
      }
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
      if (current.stage === "confirmed") {
        if (guild.captureStructureSnapshot) await guild.captureStructureSnapshot(current._id).catch(() => undefined);
        await incidents.advance(current._id, "confirmed", "containment", new Date(moment));
      }
      const lockFirst = coordinatedRaid(current);
      const lockdown = async (): Promise<InterventionStep> => lockAffectedChannels(guild, current, channelIds)
        .catch(() => ({ kind: "locked" as const, incidentId: current._id, channelIds: [] }));

      if (lockFirst) steps.push(await lockdown());
      steps.push(...await sanctionParticipants(guild, current, thresholds));
      if (!lockFirst) steps.push(await lockdown());

      if (lockdownOverdue(current, thresholds.maxLockdownMs, moment)) {
        await guild.alertOwner(
          `Anti-raid ${current._id}: lockdown-ul dureaza de peste ${Math.round(thresholds.maxLockdownMs / 60_000)} de minute. E nevoie de decizia ownerului: /anti-raid force-stop confirm:true sau prelungire.`
        );
        steps.push({ kind: "lockdown-overdue", incidentId: current._id });
      }
      return steps;
    }

    if (current.stage !== "resolved") steps.push(...await sanctionParticipants(guild, current, thresholds));

    if (current.stage === "cleanup") {
      const settled = current.participants.filter(entry => participantSettled(entry)).map(entry => entry.userId);
      const purge = await guild
        .purgeMessages(
          current.lockedChannels.map(entry => entry.channelId),
          settled,
          current.raidWebhookIds ?? [],
          new Date(current.startedAt).getTime()
        )
        .catch(() => ({ deleted: 0, unreachable: 0 }));
      if (purge.unreachable > 0) {
        await guild.alertOwner(
          `Anti-raid ${current._id}: ${purge.unreachable} mesaje ale raidului nu au putut fi sterse automat (Discord nu permite stergerea in masa peste 14 zile). Stergere manuala necesara.`
        ).catch(() => undefined);
      }
      await incidents.advance(current._id, "cleanup", "recovery", new Date(moment));
      steps.push({ kind: "cleaned", incidentId: current._id, deleted: purge.deleted, unreachable: purge.unreachable });
      return steps;
    }

    if (current.stage === "recovery") {
      if (!safetyPeriodElapsed(current, thresholds.safetyPeriodMs, moment)) {
        const remainingMs = thresholds.safetyPeriodMs - (moment - new Date(current.lastActivityAt).getTime());
        return [{ kind: "waiting", incidentId: current._id, remainingMs }];
      }
      steps.push(await restore(guild, current));
      const structure = guild.restoreStructure
        ? await guild.restoreStructure(current._id).catch(() => ({ complete: false, blocked: 0 }))
        : { complete: true, blocked: 0 };
      if (!structure.complete) {
        await guild.alertOwner(
          `Anti-raid ${current._id}: restaurarea structurii nu s-a incheiat (${structure.blocked} operatiuni cer interventia ownerului). Incidentul ramane in recovery pana cand sunt rezolvate.`
        );
        return [...steps, { kind: "waiting", incidentId: current._id, remainingMs: 0 }];
      }
      await incidents.advance(current._id, "recovery", "resolved", new Date(moment));
      await guild.publish(
        `Anti-raid ${current._id}: incident inchis. Lockdown-ul a fost ridicat, structura a fost restaurata, iar mute-urile, timeout-urile, banurile si eliminarile de roluri raman aplicate.`
      );
      return steps;
    }

    return steps;
  }

  async function markContained(guildId: string): Promise<boolean> {
    const incident = await incidents.active(guildId);
    if (!incident || incident.stage !== "containment") return false;
    if (incident.participants.length === 0) return false;
    const unsettled = incident.participants.filter(entry => !participantSettled(entry));
    if (unsettled.length > 0) return false;
    return incidents.advance(incident._id, "containment", "cleanup", new Date(now()));
  }

  return { advanceIncident, markContained, sanctionWithRetry, restore };
}

export type RaidIntervention = ReturnType<typeof createRaidIntervention>;
