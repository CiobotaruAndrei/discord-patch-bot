"use strict";

import { canonicalAction, canonicalTarget, normalizePermissionName } from "./permissionRequestTypes.js";

import type { ApprovalRestriction } from "./permissionRequestRepository.js";
import type { PermissionRequestRecord } from "./permissionRequestTypes.js";

export const DEFAULT_APPROVED_TTL_MS = 60 * 60 * 1000;

export type SubsetVerdict =
  | { ok: true; restriction: ApprovalRestriction }
  | { ok: false; problem: string };

function requestedTtl(record: PermissionRequestRecord): number {
  return typeof record.requestedTtlMs === "number" && record.requestedTtlMs > 0
    ? record.requestedTtlMs
    : DEFAULT_APPROVED_TTL_MS;
}

export function validateRestrictionIsSubset(
  record: PermissionRequestRecord,
  restriction: ApprovalRestriction
): SubsetVerdict {
  if (restriction.target !== undefined && canonicalTarget(restriction.target) !== canonicalTarget(record.target)) {
    return {
      ok: false,
      problem: `Tinta nu poate fi schimbata la aprobare: cererea era pentru \`${record.target}\`. `
        + "O tinta diferita e alta operatiune, nu o restrangere a celei cerute; respinge cererea si cere una noua."
    };
  }

  if (restriction.action !== undefined && canonicalAction(restriction.action) !== canonicalAction(record.action)) {
    return {
      ok: false,
      problem: `Actiunea nu poate fi schimbata la aprobare: cererea era pentru \`${record.action}\`. `
        + "O actiune diferita e alta operatiune, nu o restrangere."
    };
  }

  if (restriction.botId !== undefined && restriction.botId !== null) {
    const requestedBot = record.botId ?? null;
    if (requestedBot !== null && restriction.botId !== requestedBot) {
      return {
        ok: false,
        problem: `Botul executor nu poate fi schimbat la aprobare: cererea era pentru \`${requestedBot}\`. `
          + "Restrangerea inseamna limitarea la botul cerut, nu inlocuirea lui."
      };
    }
  }

  const requestedAmount = record.amount ?? null;
  if (restriction.amount !== undefined && restriction.amount !== null && requestedAmount !== null) {
    if (restriction.amount > requestedAmount) {
      return {
        ok: false,
        problem: `Cantitatea aprobata (${restriction.amount}) nu poate depasi cantitatea ceruta (${requestedAmount}).`
      };
    }
  }

  if (restriction.permissions !== undefined && (record.permissions ?? []).length > 0) {
    const requested = new Set((record.permissions ?? []).map(normalizePermissionName));
    const extra = restriction.permissions.filter(entry => !requested.has(normalizePermissionName(entry)));
    if (extra.length > 0) {
      return {
        ok: false,
        problem: `Aprobarea nu poate adauga permisiuni necerute: ${extra.join(", ")}.`
      };
    }
  }

  if (restriction.ttlMs !== undefined) {
    const maximum = requestedTtl(record);
    if (restriction.ttlMs > maximum) {
      return {
        ok: false,
        problem: `Valabilitatea aprobata nu poate depasi durata ceruta (${Math.round(maximum / 60_000)} minute).`
      };
    }
  }

  return { ok: true, restriction };
}

export function requestedDurationLabel(record: PermissionRequestRecord): string {
  const ttl = requestedTtl(record);
  if (ttl % (24 * 60 * 60 * 1000) === 0) return `${ttl / (24 * 60 * 60 * 1000)}d`;
  if (ttl % (60 * 60 * 1000) === 0) return `${ttl / (60 * 60 * 1000)}h`;
  return `${Math.max(1, Math.round(ttl / 60_000))}m`;
}
