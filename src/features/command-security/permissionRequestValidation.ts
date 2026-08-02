"use strict";

import { RESOURCE_CHANGE_ACTIONS } from "./protectedResourceTypes.js";
import { WEBHOOK_CHANGE_KINDS } from "./webhookGuardTypes.js";
import { MASS_MODERATION_ACTIONS } from "./massModerationTypes.js";
import { STRUCTURE_APPROVAL_ACTIONS } from "./serverStructureActions.js";
import { parseDurationMs } from "./permissionRequestApproval.js";
import { normalizePermissionName } from "./permissionRequestTypes.js";
import { ELEVATED_PERMISSIONS } from "./elevatedPermissions.js";

import type { PermissionRequestType } from "./permissionRequestTypes.js";

export interface PermissionRequestInput {
  type: PermissionRequestType;
  target: string;
  action: string;
  reason: string;
  amount: number | null;
  permissions: readonly string[];
  botId: string | null;
  duration: string;
}

export interface ValidatedPermissionRequest {
  target: string;
  action: string;
  amount: number | null;
  permissions: string[];
  botId: string | null;
  ttlMs: number | undefined;
}

export type ValidationResult =
  | { ok: true; value: ValidatedPermissionRequest }
  | { ok: false; problem: string };

interface TypeSchema {
  actions: readonly string[];
  targetIsSnowflake: boolean;
  targetLabel: string;
  requiresPermissions: boolean;
  requiresAmount: boolean;
}

const SNOWFLAKE = /^\d{17,20}$/;

export const REQUEST_SCHEMAS: Readonly<Record<PermissionRequestType, TypeSchema>> = {
  "bot-add": {
    actions: ["add"],
    targetIsSnowflake: true,
    targetLabel: "ID-ul botului",
    requiresPermissions: false,
    requiresAmount: false
  },
  "permission-grant": {
    actions: ["grant"],
    targetIsSnowflake: true,
    targetLabel: "ID-ul rolului sau al membrului care primeste permisiunea",
    requiresPermissions: true,
    requiresAmount: false
  },
  "moderation-mass": {
    actions: MASS_MODERATION_ACTIONS,
    targetIsSnowflake: true,
    targetLabel: "ID-ul moderatorului care executa actiunea in masa",
    requiresPermissions: false,
    requiresAmount: true
  },
  webhook: {
    actions: WEBHOOK_CHANGE_KINDS,
    targetIsSnowflake: true,
    targetLabel: "ID-ul canalului",
    requiresPermissions: false,
    requiresAmount: false
  },
  "server-structure": {
    actions: STRUCTURE_APPROVAL_ACTIONS,
    targetIsSnowflake: true,
    targetLabel: "ID-ul canalului sau al rolului",
    requiresPermissions: false,
    requiresAmount: false
  },
  "protected-resource-change": {
    actions: RESOURCE_CHANGE_ACTIONS,
    targetIsSnowflake: true,
    targetLabel: "ID-ul resursei protejate",
    requiresPermissions: false,
    requiresAmount: false
  }
};

const ELEVATED_NAMES = new Set(ELEVATED_PERMISSIONS.flatMap(entry => [
  normalizePermissionName(entry.name),
  normalizePermissionName(entry.label)
]));

export function validatePermissionRequest(input: PermissionRequestInput): ValidationResult {
  const schema = REQUEST_SCHEMAS[input.type];
  const target = input.target.trim();
  const action = input.action.trim().toLowerCase();

  if (!target || !action || !input.reason.trim()) {
    return { ok: false, problem: "Tinta, actiunea si motivul sunt obligatorii." };
  }

  if (schema.targetIsSnowflake && !SNOWFLAKE.test(target)) {
    return { ok: false, problem: `Pentru ${input.type}, tinta trebuie sa fie ${schema.targetLabel} (17-20 cifre).` };
  }

  if (!schema.actions.includes(action)) {
    return {
      ok: false,
      problem: `Pentru ${input.type}, actiunea trebuie sa fie una dintre: ${schema.actions.join(", ")}.`
    };
  }

  if (schema.requiresPermissions) {
    if (input.permissions.length === 0) {
      return { ok: false, problem: `Pentru ${input.type}, lista de permisiuni este obligatorie.` };
    }
    const unknown = input.permissions.filter(entry => !ELEVATED_NAMES.has(normalizePermissionName(entry)));
    if (unknown.length > 0) {
      return {
        ok: false,
        problem: `Permisiuni necunoscute sau neprotejate: ${unknown.join(", ")}. Aprobarea are sens doar pentru permisiuni ridicate.`
      };
    }
  }

  if (schema.requiresAmount && (input.amount === null || input.amount <= 0)) {
    return { ok: false, problem: `Pentru ${input.type}, cantitatea aprobata trebuie sa fie un numar mai mare ca zero.` };
  }

  if (!schema.requiresAmount && input.amount !== null && input.amount <= 0) {
    return { ok: false, problem: "Cantitatea aprobata trebuie sa fie mai mare ca zero." };
  }

  const botId = input.type === "bot-add" ? target : input.botId?.trim() || null;
  if (botId && !SNOWFLAKE.test(botId)) {
    return { ok: false, problem: "ID-ul botului executor trebuie sa aiba 17-20 de cifre." };
  }

  const rawDuration = input.duration.trim();
  const ttlMs = rawDuration ? parseDurationMs(rawDuration) : null;
  if (rawDuration && ttlMs === null) {
    return { ok: false, problem: "Valabilitatea nu este valida. Foloseste un format ca 30m, 2h sau 1d." };
  }

  return {
    ok: true,
    value: {
      target,
      action,
      amount: input.amount,
      permissions: [...input.permissions],
      botId,
      ttlMs: ttlMs ?? undefined
    }
  };
}
