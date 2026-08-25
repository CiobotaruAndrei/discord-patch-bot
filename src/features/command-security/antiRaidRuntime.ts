"use strict";

import { createRaidDetector, signalsFromMessage, structureSignal } from "./antiRaidDetection.js";

import type { StructureSurface } from "./antiRaidDetection.js";
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
  readGuildSettings: (guildId: string) => Promise<{ antiRaidThresholds?: Record<string, unknown> | null; antiRaidAlertChannelId?: string | null; antiRaidEnabled?: boolean; antiRaidDryRunEnabled?: boolean } | null>;
  listActiveGuildIds?: () => Promise<string[]>;
  findStructureActor?: (guildId: string, resourceId: string) => Promise<{ id: string; bot: boolean } | null>;
  isGuildOwner?: (guildId: string, actorId: string) => Promise<boolean>;
  consumeStructureApproval?: (guildId: string, actorId: string, resourceId: string, action: string) => Promise<boolean>;
  resolveGuild: (guildId: string) => Promise<RaidGuildPort | null>;
  logger?: (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;
  now?: () => number;
}

export interface StructureChangeInput {
  surface?: StructureSurface;
  action?: string;
  approvalChecked?: boolean;
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

  async function dryRunFor(guildId: string): Promise<boolean> {
    const settings = await deps.readGuildSettings(guildId).catch(() => null);
    return settings?.antiRaidDryRunEnabled === true;
  }

  async function moduleActive(guildId: string): Promise<boolean> {
    const settings = await deps.readGuildSettings(guildId).catch(() => null);
    return settings?.antiRaidEnabled === true || settings?.antiRaidDryRunEnabled === true;
  }

  function sameThresholds(left: AntiRaidThresholds, right: AntiRaidThresholds): boolean {
    return (Object.keys(right) as Array<keyof AntiRaidThresholds>).every(key => left[key] === right[key]);
  }

  function pruneDetectors(): void {
    const cutoff = now() - DETECTOR_IDLE_MS;
    for (const [guildId, entry] of detectors) if (entry.touchedAt < cutoff) detectors.delete(guildId);
  }

  async function detectorFor(guildId: string): Promise<RaidDetector> {
    pruneDetectors();
    const thresholds = await thresholdsFor(guildId).catch(() => DEFAULT_ANTI_RAID_THRESHOLDS);
    const existing = detectors.get(guildId);
    if (existing && sameThresholds(existing.thresholds, thresholds)) {
      existing.touchedAt = now();
      return existing.detector;
    }
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

  const botActors = new Map<string, Set<string>>();

  function rememberActor(guildId: string, actorId: string, bot: boolean): void {
    if (!bot) return;
    const known = botActors.get(guildId);
    if (known) known.add(actorId); else botActors.set(guildId, new Set([actorId]));
  }

  function isBotActor(guildId: string, actorId: string): boolean {
    return botActors.get(guildId)?.has(actorId) === true;
  }

  async function freezeBaselineFor(guildId: string): Promise<void> {
    const guild = await deps.resolveGuild(guildId).catch(() => null);
    if (!guild?.freezeStructureBaseline) return;
    await guild.freezeStructureBaseline().catch(() => undefined);
  }

  async function registerParticipants(guildId: string, incidentId: string, actorIds: readonly string[]): Promise<void> {
    for (const actorId of actorIds) {
      await incidents.addParticipant(incidentId, actorId, isBotActor(guildId, actorId), new Date(now())).catch(() => false);
    }
  }

  async function touchIfAssociated(
    incident: { _id: string; participants: readonly { userId: string }[] },
    actorId: string,
    responsibleActorIds: readonly string[]
  ): Promise<void> {
    const associated = responsibleActorIds.includes(actorId)
      || incident.participants.some(entry => entry.userId === actorId);
    if (!associated) return;
    await incidents.touch(incident._id, new Date(now())).catch(() => false);
  }

  async function observeMessage(guildId: string, observation: MessageObservation): Promise<ObserveOutcome> {
    if (!observation.actorId) return { kind: "ignored" };
    if (!await moduleActive(guildId)) return { kind: "ignored" };

    rememberActor(guildId, observation.actorId, observation.bot);
    const detector = await detectorFor(guildId);
    const verdict = detector.observeAll(signalsFromMessage(observation), observation.at);

    const active = await incidents.active(guildId).catch(() => null);
    if (active) {
      await touchIfAssociated(active, observation.actorId, verdict.actorIds);
      if (verdict.triggered) {
        await registerParticipants(guildId, active._id, verdict.actorIds);
        await runIntervention(guildId, verdict.channelIds);
      }
      return { kind: "existing", incidentId: active._id };
    }

    if (!verdict.triggered) return { kind: "quiet" };

    const incident = await incidents.open(
      { guildId, triggerReason: verdict.reason, dryRun: await dryRunFor(guildId) },
      new Date(now())
    );
    if (!incident) return { kind: "quiet" };
    if (!active) await freezeBaselineFor(guildId);

    await registerParticipants(guildId, incident._id, verdict.actorIds);
    await runIntervention(guildId, verdict.channelIds);
    return { kind: "opened", incidentId: incident._id, reason: verdict.reason, participants: [...verdict.actorIds] };
  }

  async function observeStructureChange(
    guildId: string,
    resourceId: string,
    actor?: { id: string; bot: boolean } | null,
    change: StructureChangeInput = {}
  ): Promise<ObserveOutcome> {
    if (!await moduleActive(guildId)) return { kind: "ignored" };
    const resolved = actor ?? (deps.findStructureActor
      ? await deps.findStructureActor(guildId, resourceId).catch(() => null)
      : null);
    if (!resolved?.id) return { kind: "ignored" };
    const actorId = resolved.id;
    const bot = resolved.bot;

    if (deps.isGuildOwner && await deps.isGuildOwner(guildId, actorId).catch(() => false)) return { kind: "ignored" };
    if (deps.consumeStructureApproval && change.approvalChecked !== true) {
      const approved = await deps
        .consumeStructureApproval(guildId, actorId, resourceId, change.action ?? "create")
        .catch(() => false);
      if (approved) return { kind: "ignored" };
    }

    rememberActor(guildId, actorId, bot);
    const detector = await detectorFor(guildId);
    const verdict = detector.observe(structureSignal(actorId, bot, resourceId, now(), change.surface ?? "channel"));
    if (!verdict.triggered) {
      const running = await incidents.active(guildId).catch(() => null);
      if (running) await touchIfAssociated(running, actorId, []);
      return running ? { kind: "existing", incidentId: running._id } : { kind: "quiet" };
    }

    const active = await incidents.active(guildId).catch(() => null);
    if (active) await touchIfAssociated(active, actorId, verdict.actorIds);
    const incident = active ?? await incidents.open(
      { guildId, triggerReason: verdict.reason, dryRun: await dryRunFor(guildId) },
      new Date(now())
    );
    if (!incident) return { kind: "quiet" };
    if (!active) await freezeBaselineFor(guildId);

    if ((change.action ?? "create") === "create") {
      await incidents
        .recordRaidResource(incident._id, change.surface === "role" ? "role" : "channel", resourceId)
        .catch(() => false);
    }

    await registerParticipants(guildId, incident._id, verdict.actorIds);
    await runIntervention(guildId, verdict.channelIds);
    return active
      ? { kind: "existing", incidentId: incident._id }
      : { kind: "opened", incidentId: incident._id, reason: verdict.reason, participants: [...verdict.actorIds] };
  }

  async function observeBotJoin(guildId: string, botId: string): Promise<ObserveOutcome> {
    if (!await moduleActive(guildId)) return { kind: "ignored" };
    const active = await incidents.active(guildId).catch(() => null);
    if (!active || !raidConfirmed(active.stage)) return { kind: "quiet" };

    rememberActor(guildId, botId, true);
    await incidents.addParticipant(active._id, botId, true, new Date(now())).catch(() => false);
    await sanctionBotAdder(guildId, botId, active._id);
    await runIntervention(guildId, []);
    return { kind: "existing", incidentId: active._id };
  }

  async function sanctionBotAdder(guildId: string, botId: string, incidentId: string): Promise<void> {
    const guild = await deps.resolveGuild(guildId).catch(() => null);
    if (!guild?.findBotAdder) return;
    const adderId = await guild.findBotAdder(botId).catch(() => null);
    if (!adderId || adderId === botId) return;

    rememberActor(guildId, adderId, false);
    const added = await incidents.addParticipant(incidentId, adderId, false, new Date(now())).catch(() => false);
    if (!added) return;

    const reason = `Anti-raid ${incidentId}: a adaugat un bot in timpul unui raid confirmat`;
    const plan = guild.stripElevatedRoles
      ? await guild.stripElevatedRoles(adderId, reason).catch(() => null)
      : null;

    const outcome = plan === null
      ? "Rolurile nu au putut fi verificate; verificare manuala necesara."
      : plan.removed.length === 0 && plan.blocked.length === 0
        ? "Autorul nu avea roluri cu permisiuni ridicate."
        : [
          plan.removed.length > 0 ? `Roluri eliminate: ${plan.removed.join(", ")}.` : "",
          plan.blocked.length > 0 ? `Roluri care NU au putut fi eliminate: ${plan.blocked.join(", ")}.` : ""
        ].filter(Boolean).join(" ");

    await guild.publish(
      `Anti-raid ${incidentId}: <@${adderId}> a adaugat botul <@${botId}> in timpul raidului. Botul primeste ban. ${outcome}`
    ).catch(() => undefined);
  }

  async function tick(guildId: string): Promise<ObserveOutcome> {
    const active = await incidents.active(guildId).catch(() => null);
    if (!active) return { kind: "quiet" };
    await runIntervention(guildId, []);
    return { kind: "existing", incidentId: active._id };
  }

  async function sweep(): Promise<string[]> {
    const guildIds = await (deps.listActiveGuildIds
      ? deps.listActiveGuildIds()
      : incidents.activeGuildIds()).catch(() => []);
    const driven: string[] = [];
    for (const guildId of guildIds) {
      const outcome = await tick(guildId).catch(() => ({ kind: "quiet" as const }));
      if (outcome.kind === "existing") driven.push(guildId);
    }
    return driven;
  }

  function forget(guildId: string): void {
    detectors.delete(guildId);
    botActors.delete(guildId);
  }

  async function escalateActor(guildId: string, actorId: string, surface: string): Promise<boolean> {
    const active = await incidents.active(guildId).catch(() => null);
    if (!active || !raidConfirmed(active.stage)) return false;
    rememberActor(guildId, actorId, false);
    const added = await incidents.addParticipant(active._id, actorId, false, new Date(now())).catch(() => false);
    if (!added) return false;
    const guild = await deps.resolveGuild(guildId).catch(() => null);
    await guild?.publish(
      `Anti-raid ${active._id}: <@${actorId}> a incercat o modificare administrativa (${surface}) in timpul raidului. Modificarea a fost revenita si autorul intra in incident.`
    ).catch(() => undefined);
    await runIntervention(guildId, []);
    return true;
  }

  async function observeRaidWebhook(guildId: string, webhookId: string): Promise<boolean> {
    const active = await incidents.active(guildId).catch(() => null);
    if (!active || !raidConfirmed(active.stage)) return false;
    return incidents.recordRaidWebhook(active._id, webhookId).catch(() => false);
  }

  async function captureBaseline(guildId: string): Promise<boolean> {
    const guild = await deps.resolveGuild(guildId).catch(() => null);
    if (!guild?.refreshStructureBaseline) return false;
    const refreshed = await guild.refreshStructureBaseline().catch(() => false);
    return refreshed === true;
  }

  return {
    captureBaseline,
    observeMessage,
    observeStructureChange,
    observeBotJoin,
    observeRaidWebhook,
    escalateActor,
    tick,
    sweep,
    isRaidConfirmed,
    forget
  };
}

export type AntiRaidRuntime = ReturnType<typeof createAntiRaidRuntime>;
