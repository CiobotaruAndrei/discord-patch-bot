"use strict";

import type { ProtectedResourceType } from "./protectedResourceTypes.js";

export interface GuardCapability {
  botHighestRolePosition: number | null;
  botCanManageChannels: boolean;
  botCanManageRoles: boolean;
  botCanViewAuditLog: boolean;
}

export interface ChannelReadinessInput {
  type: Extract<ProtectedResourceType, "channel" | "category">;
  managerRoles: readonly { id: string; name: string; position: number; administrator: boolean }[];
  managerMembers: readonly { id: string; administrator: boolean }[];
}

export interface RoleReadinessInput {
  type: Extract<ProtectedResourceType, "role">;
  rolePosition: number;
  rolesBelow: readonly { id: string; name: string; position: number }[];
  rolesAbove: readonly { id: string; name: string; position: number }[];
}

export type ReadinessInput = ChannelReadinessInput | RoleReadinessInput;

export interface ReadinessVerdict {
  degraded: boolean;
  reasons: string[];
  preventable: boolean;
}

const AUDIT_LOG_REASON = "Botul nu are View Audit Log, deci autorul unei modificari nu poate fi confirmat si nu se aplica nicio sanctiune.";

export function evaluateProtectionReadiness(capability: GuardCapability, input: ReadinessInput): ReadinessVerdict {
  const reasons: string[] = [];
  if (!capability.botCanViewAuditLog) reasons.push(AUDIT_LOG_REASON);

  const preventable = input.type === "role"
    ? evaluateRole(capability, input, reasons)
    : evaluateChannel(capability, input, reasons);

  return { degraded: reasons.length > 0, reasons, preventable };
}

function evaluateChannel(capability: GuardCapability, input: ChannelReadinessInput, reasons: string[]): boolean {
  if (!capability.botCanManageChannels) {
    reasons.push("Botul nu are Manage Channels, deci nu poate elimina accesul neautorizat si nu poate restaura resursa.");
    return false;
  }

  const adminRoles = input.managerRoles.filter(role => role.administrator);
  if (adminRoles.length > 0) {
    reasons.push(
      `Rolurile cu Administrator ignora overwrite-urile canalului, deci prevenirea nu poate fi garantata pentru: ${adminRoles.map(role => role.name).join(", ")}.`
    );
  }

  const adminMembers = input.managerMembers.filter(member => member.administrator);
  if (adminMembers.length > 0) {
    reasons.push(
      `${adminMembers.length} membri au Administrator direct si ignora overwrite-urile canalului; raman doar Audit Log si reactia de dupa eveniment.`
    );
  }

  const botPosition = capability.botHighestRolePosition;
  const unreachable = botPosition === null ? adminRoles : adminRoles.filter(role => role.position >= botPosition);
  if (unreachable.length > 0) {
    reasons.push(
      `Rolul botului nu este deasupra rolurilor ${unreachable.map(role => role.name).join(", ")}, deci autorii cu aceste roluri nu pot fi sanctionati.`
    );
  }

  return adminRoles.length === 0 && adminMembers.length === 0;
}

function evaluateRole(capability: GuardCapability, input: RoleReadinessInput, reasons: string[]): boolean {
  if (!capability.botCanManageRoles) {
    reasons.push("Botul nu are Manage Roles, deci nu poate restaura rolul si nu poate elimina rolurile autorului.");
    return false;
  }

  if (capability.botHighestRolePosition === null || capability.botHighestRolePosition <= input.rolePosition) {
    reasons.push("Rolul botului nu este deasupra rolului protejat, deci Discord nu ii permite sa il restaureze sau sa il recreeze.");
    return false;
  }

  if (input.rolesAbove.length > 0) {
    reasons.push(
      `Rolul protejat nu este deasupra tuturor rolurilor care il pot administra; sunt mai sus: ${input.rolesAbove.map(role => role.name).join(", ")}.`
    );
  }

  return input.rolesAbove.length === 0;
}

export function describeReadiness(verdict: ReadinessVerdict): string {
  if (!verdict.degraded) return "Protectie completa: prevenirea si restaurarea sunt posibile.";
  return `Marcata **degraded**. Cauze:\n${verdict.reasons.map(reason => `- ${reason}`).join("\n")}`;
}
