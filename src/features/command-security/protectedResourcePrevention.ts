"use strict";

export interface PreventionTarget {
  id: string;
  name: string;
  kind: "role" | "member";
  administrator: boolean;
}

export interface PreventionPlan {
  deny: PreventionTarget[];
  blocked: PreventionTarget[];
}

export interface PreventionOutcome {
  applied: PreventionTarget[];
  failed: PreventionTarget[];
  blocked: PreventionTarget[];
  verified: boolean;
}

export interface PreventionPort {
  denyManageChannels(targetId: string, reason: string): Promise<unknown>;
  readDeniedTargets(): Promise<string[] | null>;
}

export const PREVENTION_REASON =
  "Protectie resurse: acces Manage Channels eliminat preventiv pentru o resursa protejata";

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
    return { applied: [], failed: [], blocked: plan.blocked, verified: true };
  }

  for (const target of plan.deny) {
    await port.denyManageChannels(target.id, PREVENTION_REASON).catch(() => undefined);
  }

  const denied = await port.readDeniedTargets().catch(() => null);
  if (!denied) {
    return { applied: [], failed: [...plan.deny], blocked: plan.blocked, verified: false };
  }

  const confirmed = new Set(denied);
  return {
    applied: plan.deny.filter(target => confirmed.has(target.id)),
    failed: plan.deny.filter(target => !confirmed.has(target.id)),
    blocked: plan.blocked,
    verified: true
  };
}

export function preventionHolds(outcome: PreventionOutcome): boolean {
  return outcome.verified && outcome.failed.length === 0 && outcome.blocked.length === 0;
}

function names(targets: readonly PreventionTarget[]): string {
  return targets.map(target => target.name).join(", ");
}

export function describePrevention(outcome: PreventionOutcome): string {
  const lines: string[] = [];
  if (outcome.applied.length > 0) {
    lines.push(`Prevenire aplicata si verificata: Manage Channels eliminat pentru ${names(outcome.applied)}.`);
  }
  if (outcome.failed.length > 0) {
    lines.push(outcome.verified
      ? `Prevenirea NU s-a aplicat pentru ${names(outcome.failed)}; acele tinte pot inca administra canalul.`
      : `Prevenirea nu a putut fi verificata dupa scriere pentru ${names(outcome.failed)}; verificare manuala necesara.`);
  }
  if (outcome.blocked.length > 0) {
    lines.push(`Nu se poate preveni pentru ${names(outcome.blocked)}: Administrator ignora overwrite-urile canalului.`);
  }
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

function overwriteEntries(channel: PreventableChannel): Array<{ id: string; type: unknown; deny?: { has?: (flag: string) => boolean } }> {
  const entries: Array<{ id: string; type: unknown; deny?: { has?: (flag: string) => boolean } }> = [];
  for (const item of channel.permissionOverwrites?.cache?.values?.() ?? []) {
    const entry = item as { id?: unknown; type?: unknown; deny?: { has?: (flag: string) => boolean } };
    if (typeof entry.id === "string") entries.push({ id: entry.id, type: entry.type, deny: entry.deny });
  }
  return entries;
}

export function memberOverwriteTargets(channel: PreventableChannel): string[] {
  return overwriteEntries(channel)
    .filter(entry => entry.type === MEMBER_OVERWRITE_TYPE || entry.type === "member")
    .map(entry => entry.id);
}

export function adaptPreventionPort(channel: PreventableChannel): PreventionPort | null {
  const edit = channel.permissionOverwrites?.edit;
  if (!edit) return null;
  return {
    denyManageChannels: (targetId, reason) => edit(targetId, { ManageChannels: false }, { reason }),
    readDeniedTargets: async () => overwriteEntries(channel)
      .filter(entry => entry.deny?.has?.("ManageChannels") === true)
      .map(entry => entry.id)
  };
}
