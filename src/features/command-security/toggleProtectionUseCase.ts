"use strict";

export type ProtectionCommand = "start" | "stop";

export type ProtectionBackfillResult = {
  delivered: number;
  sentUnconfirmed: number;
  undetermined: number;
};

export type ToggleProtectionOutcome =
  | { kind: "unknown-subcommand" }
  | { kind: "channel-not-set" }
  | { kind: "channel-missing-permissions" }
  | { kind: "not-ready"; missing: readonly string[] }
  | { kind: "owner-only"; subcommand: string }
  | { kind: "confirmation-required"; subcommand: string }
  | { kind: "atomic-stop-failed"; subcommand: string; error: unknown }
  | { kind: "stopped-with-cancellations"; subcommand: string; cancelled: number }
  | { kind: "started-with-backfill"; subcommand: string; result: ProtectionBackfillResult }
  | { kind: "toggled"; subcommand: string; command: ProtectionCommand };

export type ToggleProtectionInput = {
  command: ProtectionCommand;
  subcommand: string;
  hasToggleFields: boolean;
  needsReadinessCheck: boolean;
  ownerOnly?: boolean;
  isOwner?: boolean;
  confirmed?: boolean;
  needsAtomicStop: boolean;
  needsBackfill: boolean;
};

export type ToggleProtectionDeps = {
  readConfiguredChannel: () => string | null;
  readinessGaps: () => readonly string[];
  readChannelPermissions: (channelId: string) => Promise<{ viewChannel?: boolean; sendMessages?: boolean; embedLinks?: boolean } | null>;
  countActiveApprovals: () => number | Promise<number>;
  stopAtomically: () => Promise<void>;
  persistEnabled: (enabled: boolean) => Promise<void>;
  runBackfill: () => Promise<ProtectionBackfillResult>;
};

export async function toggleProtection(
  input: ToggleProtectionInput,
  deps: ToggleProtectionDeps
): Promise<ToggleProtectionOutcome> {
  if (!input.hasToggleFields) return { kind: "unknown-subcommand" };

  if (input.command === "stop" && input.ownerOnly === true) {
    if (input.isOwner !== true) return { kind: "owner-only", subcommand: input.subcommand };
    if (input.confirmed !== true) return { kind: "confirmation-required", subcommand: input.subcommand };
  }

  if (input.command === "start") {
    const channelId = deps.readConfiguredChannel();
    if (!channelId) return { kind: "channel-not-set" };

    const permissions = await deps.readChannelPermissions(channelId);
    if (permissions?.viewChannel !== true || permissions.sendMessages !== true || permissions.embedLinks !== true) {
      return { kind: "channel-missing-permissions" };
    }

    if (input.needsReadinessCheck) {
      const missing = deps.readinessGaps();
      if (missing.length > 0) return { kind: "not-ready", missing };
    }
  }

  if (input.command === "stop" && input.needsAtomicStop) {
    const cancelled = await deps.countActiveApprovals();
    try {
      await deps.stopAtomically();
    } catch (error: unknown) {
      return { kind: "atomic-stop-failed", subcommand: input.subcommand, error };
    }
    return { kind: "stopped-with-cancellations", subcommand: input.subcommand, cancelled };
  }

  await deps.persistEnabled(input.command === "start");

  if (input.command === "start" && input.needsBackfill) {
    try {
      const result = await deps.runBackfill();
      return { kind: "started-with-backfill", subcommand: input.subcommand, result };
    } catch (error: unknown) {
      await deps.persistEnabled(false);
      throw error;
    }
  }

  return { kind: "toggled", subcommand: input.subcommand, command: input.command };
}
