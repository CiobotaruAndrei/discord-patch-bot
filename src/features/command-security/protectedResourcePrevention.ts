"use strict";

export type PreviousAccess = "allow" | "deny" | "inherit";

export interface PreventionTarget {
  id: string;
  name: string;
  kind: "role" | "member";
  administrator: boolean;
}

export interface RestoredTarget {
  id: string;
  previous: PreviousAccess;
}

export interface PreventionPlan {
  deny: PreventionTarget[];
  blocked: PreventionTarget[];
}

export interface PreventionOutcome {
  applied: PreventionTarget[];
  failed: PreventionTarget[];
  blocked: PreventionTarget[];
  restorePoints: RestoredTarget[];
  verified: boolean;
}

export interface PreventionPort {
  readAccess(targetId: string): Promise<PreviousAccess>;
  setManageChannels(targetId: string, value: boolean | null, reason: string): Promise<unknown>;
  readDeniedTargets(): Promise<string[] | null>;
}

export const PREVENTION_REASON =
  "Protectie resurse: acces Manage Channels eliminat preventiv pentru o resursa protejata";

export const PREVENTION_RESTORE_REASON =
  "Protectie resurse: resursa nu mai e protejata, accesul preventiv restrictionat a fost restaurat";

export function planChannelPrevention(managers: readonly PreventionTarget[]): PreventionPlan {
  const deny: PreventionTarget[] = [];
  const blocked: PreventionTarget[] = [];
  for (const manager of managers) {
    if (manager.administrator) blocked.push(manager);
    else deny.push(manager);
  }
  return { deny, blocked };
}

export async function applyChannelPrevention(plan: PreventionPlan, port: PreventionPort): Promise<PreventionOutcome> {
  if (plan.deny.length === 0) {
    return { applied: [], failed: [], blocked: plan.blocked, restorePoints: [], verified: true };
  }

  const restorePoints: RestoredTarget[] = [];
  for (const target of plan.deny) {
    const previous = await port.readAccess(target.id).catch<PreviousAccess>(() => "inherit");
    restorePoints.push({ id: target.id, previous });
    await port.setManageChannels(target.id, false, PREVENTION_REASON).catch(() => undefined);
  }

  const denied = await port.readDeniedTargets().catch(() => null);
  if (!denied) {
    return { applied: [], failed: [...plan.deny], blocked: plan.blocked, restorePoints, verified: false };
  }

  const confirmed = new Set(denied);
  const applied = plan.deny.filter(target => confirmed.has(target.id));
  return {
    applied,
    failed: plan.deny.filter(target => !confirmed.has(target.id)),
    blocked: plan.blocked,
    restorePoints: restorePoints.filter(point => confirmed.has(point.id)),
    verified: true
  };
}

export async function restoreChannelPrevention(
  port: PreventionPort,
  saved: readonly RestoredTarget[]
): Promise<number> {
  let restored = 0;
  for (const point of saved) {
    const value = point.previous === "allow" ? true : point.previous === "deny" ? false : null;
    const done = await port
      .setManageChannels(point.id, value, PREVENTION_RESTORE_REASON)
      .then(() => true, () => false);
    if (done) restored += 1;
  }
  return restored;
}

export function preventionHolds(outcome: PreventionOutcome): boolean {
  return outcome.verified && outcome.failed.length === 0 && outcome.blocked.length === 0;
}

function names(targets: readonly PreventionTarget[]): string {
  return targets.map(target => target.name).join(", ");
}

export function preventionGaps(outcome: PreventionOutcome): string[] {
  const gaps: string[] = [];
  if (outcome.failed.length > 0) {
    gaps.push(outcome.verified
      ? `Prevenirea nu s-a aplicat pentru ${names(outcome.failed)}, deci acele tinte pot inca administra canalul.`
      : `Prevenirea nu a putut fi verificata dupa scriere pentru ${names(outcome.failed)}.`);
  }
  if (outcome.blocked.length > 0) {
    gaps.push(`${names(outcome.blocked)} au Administrator si ignora overwrite-urile canalului, deci prevenirea nu se poate garanta.`);
  }
  return gaps;
}

export function describePrevention(outcome: PreventionOutcome): string {
  const lines: string[] = [];
  if (outcome.applied.length > 0) {
    lines.push(`Prevenire aplicata si verificata: Manage Channels eliminat pentru ${names(outcome.applied)}.`);
  }
  lines.push(...preventionGaps(outcome));
  if (lines.length === 0) lines.push("Nu exista roluri sau membri de restrictionat preventiv pe acest canal.");
  return lines.join("\n");
}

export interface PreventableChannel {
  permissionOverwrites?: {
    cache?: { values?: () => Iterable<unknown> };
    edit?: (targetId: string, permissions: Record<string, boolean | null>, options?: { reason?: string }) => Promise<unknown>;
  };
}

const MEMBER_OVERWRITE_TYPE = 1;

interface OverwriteEntry {
  id: string;
  type: unknown;
  allow?: { has?: (flag: string) => boolean };
  deny?: { has?: (flag: string) => boolean };
}

function overwriteEntries(channel: PreventableChannel): OverwriteEntry[] {
  const entries: OverwriteEntry[] = [];
  for (const item of channel.permissionOverwrites?.cache?.values?.() ?? []) {
    const entry = item as { id?: unknown; type?: unknown; allow?: OverwriteEntry["allow"]; deny?: OverwriteEntry["deny"] };
    if (typeof entry.id === "string") entries.push({ id: entry.id, type: entry.type, allow: entry.allow, deny: entry.deny });
  }
  return entries;
}

function isMember(entry: OverwriteEntry): boolean {
  return entry.type === MEMBER_OVERWRITE_TYPE || entry.type === "member";
}

export function memberOverwriteTargets(channel: PreventableChannel): string[] {
  return overwriteEntries(channel)
    .filter(entry => isMember(entry) && entry.allow?.has?.("ManageChannels") === true)
    .map(entry => entry.id);
}

export function adaptPreventionPort(channel: PreventableChannel): PreventionPort | null {
  const edit = channel.permissionOverwrites?.edit;
  if (!edit) return null;
  return {
    readAccess: async targetId => {
      const entry = overwriteEntries(channel).find(candidate => candidate.id === targetId);
      if (entry?.allow?.has?.("ManageChannels") === true) return "allow";
      if (entry?.deny?.has?.("ManageChannels") === true) return "deny";
      return "inherit";
    },
    setManageChannels: (targetId, value, reason) => edit(targetId, { ManageChannels: value }, { reason }),
    readDeniedTargets: async () => overwriteEntries(channel)
      .filter(entry => entry.deny?.has?.("ManageChannels") === true)
      .map(entry => entry.id)
  };
}
