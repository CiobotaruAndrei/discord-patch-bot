"use strict";

import { createRaidDetector, signalsFromMessage, structureSignal } from "./antiRaidDetection.js";
import { createRaidIncidentRepository } from "./antiRaidIncidentRepository.js";
import { createRaidIntervention } from "./antiRaidIntervention.js";
import { raidConfirmed } from "./antiRaidIncidentTypes.js";
import { DEFAULT_ANTI_RAID_THRESHOLDS, readThresholds } from "./antiRaidThresholds.js";

import type { RaidIncidentModelLike } from "./antiRaidIncidentRepository.js";
import type { RaidGuildPort } from "./antiRaidIntervention.js";
import type { AntiRaidThresholds } from "./antiRaidThresholds.js";
import type { MessageObservation, RaidDetector } from "./antiRaidDetection.js";

export interface AntiRaidRuntimeDeps {
  RaidIncidentModel: RaidIncidentModelLike;
  readGuildSettings: (guildId: string) => Promise<{ antiRaidThresholds?: Record<string, unknown> | null; antiRaidAlertChannelId?: string | null } | null>;
  resolveGuild: (guildId: string) => Promise<RaidGuildPort | null>;
  logger?: (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;
  now?: () => number;
}

export type ObserveOutcome =
  | { kind: "ignored" }
  | { kind: "quiet" }
  | { kind: "existing"; incidentId: string }
  | { kind: "opened"; incidentId: string; reason: string; participants: string[] };

const DETECTOR_IDLE_MS = 10 * 60_000;

export function createAntiRaidRuntime(deps: AntiRaidRuntimeDeps) {
  const incidents = createRaidIncidentRepository(deps.RaidIncidentModel);
  const now = deps.now ?? Date.now;
  const detectors = new Map<string, { detector: RaidDetector; thresholds: AntiRaidThresholds; touchedAt: number }>();

  const intervention = createRaidIntervention({
    RaidIncidentModel: deps.RaidIncidentModel,
    thresholds: guildId => thresholdsFor(guildId),
    now
  });

  async function thresholdsFor(guildId: string): Promise<AntiRaidThresholds> {
    const settings = await deps.readGuildSettings(guildId).catch(() => null);
    return readThresholds(settings?.antiRaidThresholds);
  }

  function pruneDetectors(): void {
    const cutoff = now() - DETECTOR_IDLE_MS;
    for (const [guildId, entry] of detectors) if (entry.touchedAt < cutoff) detectors.delete(guildId);
  }

  async function detectorFor(guildId: string): Promise<RaidDetector> {
    pruneDetectors();
    const existing = detectors.get(guildId);
    if (existing) {
      existing.touchedAt = now();
      return existing.detector;
    }
    const thresholds = await thresholdsFor(guildId).catch(() => DEFAULT_ANTI_RAID_THRESHOLDS);
    const detector = createRaidDetector({ thresholds });
    detectors.set(guildId, { detector, thresholds, touchedAt: now() });
    return detector;
  }

  async function isRaidConfirmed(guildId: string): Promise<boolean> {
    const incident = await incidents.active(guildId).catch(() => null);
    return incident !== null && raidConfirmed(incident.stage);
  }

  async function runIntervention(guildId: string, channelIds: readonly string[]): Promise<void> {
    const guild = await deps.resolveGuild(guildId).catch(() => null);
    if (!guild) {
      deps.logger?.("WARN", "ANTI_RAID", "Serverul nu a putut fi rezolvat pentru interventie", { guildId });
      return;
    }
    await intervention.advanceIncident(guild, channelIds).catch(error => {
      deps.logger?.("ERROR", "ANTI_RAID", "Interventia a esuat", {
        guildId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    await intervention.markContained(guildId).catch(() => false);
  }

  async function registerParticipants(incidentId: string, actorIds: readonly string[], bots: ReadonlySet<string>): Promise<void> {
    for (const actorId of actorIds) {
      await incidents.addParticipant(incidentId, actorId, bots.has(actorId), new Date(now())).catch(() => false);
    }
  }

  async function observeMessage(guildId: string, observation: MessageObservation): Promise<ObserveOutcome> {
    if (!observation.actorId) return { kind: "ignored" };

    const detector = await detectorFor(guildId);
    const verdict = detector.observeAll(signalsFromMessage(observation), observation.at);

    const active = await incidents.active(guildId).catch(() => null);
    if (active) {
      if (verdict.triggered) {
        await registerParticipants(active._id, verdict.actorIds, new Set(observation.bot ? [observation.actorId] : []));
        await runIntervention(guildId, verdict.channelIds);
        return { kind: "existing", incidentId: active._id };
      }
      return { kind: "existing", incidentId: active._id };
    }

    if (!verdict.triggered) return { kind: "quiet" };

    const incident = await incidents.open({ guildId, triggerReason: verdict.reason }, new Date(now()));
    if (!incident) return { kind: "quiet" };

    await registerParticipants(incident._id, verdict.actorIds, new Set(observation.bot ? [observation.actorId] : []));
    await runIntervention(guildId, verdict.channelIds);
    return { kind: "opened", incidentId: incident._id, reason: verdict.reason, participants: [...verdict.actorIds] };
  }

  async function observeStructureChange(
    guildId: string,
    actorId: string | null,
    bot: boolean,
    resourceId: string
  ): Promise<ObserveOutcome> {
    if (!actorId) return { kind: "ignored" };

    const detector = await detectorFor(guildId);
    const verdict = detector.observe(structureSignal(actorId, bot, resourceId, now()));
    if (!verdict.triggered) {
      const active = await incidents.active(guildId).catch(() => null);
      return active ? { kind: "existing", incidentId: active._id } : { kind: "quiet" };
    }

    const active = await incidents.active(guildId).catch(() => null);
    const incident = active ?? await incidents.open({ guildId, triggerReason: verdict.reason }, new Date(now()));
    if (!incident) return { kind: "quiet" };

    await registerParticipants(incident._id, verdict.actorIds, new Set(bot ? [actorId] : []));
    await runIntervention(guildId, verdict.channelIds);
    return active
      ? { kind: "existing", incidentId: incident._id }
      : { kind: "opened", incidentId: incident._id, reason: verdict.reason, participants: [...verdict.actorIds] };
  }

  async function observeBotJoin(guildId: string, botId: string): Promise<ObserveOutcome> {
    const active = await incidents.active(guildId).catch(() => null);
    if (!active || !raidConfirmed(active.stage)) return { kind: "quiet" };

    await incidents.addParticipant(active._id, botId, true, new Date(now())).catch(() => false);
    await runIntervention(guildId, []);
    return { kind: "existing", incidentId: active._id };
  }

  async function tick(guildId: string): Promise<ObserveOutcome> {
    const active = await incidents.active(guildId).catch(() => null);
    if (!active) return { kind: "quiet" };
    await runIntervention(guildId, []);
    return { kind: "existing", incidentId: active._id };
  }

  function forget(guildId: string): void {
    detectors.delete(guildId);
  }

  return { observeMessage, observeStructureChange, observeBotJoin, tick, isRaidConfirmed, forget };
}

export type AntiRaidRuntime = ReturnType<typeof createAntiRaidRuntime>;
