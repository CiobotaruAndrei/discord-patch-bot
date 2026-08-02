"use strict";

import { createMassModerationRepository } from "./massModerationRepository.js";
import { breachesThreshold, describeWindow, distinctTargets, dominantAction, withinWindow } from "./massModerationTypes.js";
import { type SanctionRole } from "./elevatedRoleSanction.js";
import { describeSanctionOutcome, executeElevatedRoleSanction } from "./elevatedRoleSanction.js";

import type { MassModerationModelLike } from "./massModerationRepository.js";
import type { MassModerationAction, MassModerationEvent } from "./massModerationTypes.js";
import type { LogLevel } from "../../shared/logging.js";

export interface MassModerationActor {
  roles: readonly SanctionRole[];
  removeRoles(roleIds: readonly string[], reason: string): Promise<unknown>;
}

export interface MassModerationGuild {
  id: string;
  ownerId: string | null;
  botHighestRolePosition: number | null;
  everyoneRoleId: string;
  resolveActor(actorId: string): Promise<MassModerationActor | null>;
  liftBan(targetId: string, reason: string): Promise<boolean>;
}

export interface MassModerationGate {
  readSituation(guildId: string): Promise<{ guardEnabled: boolean; raidConfirmed: boolean }>;
  consumeApproval(guildId: string, actorId: string, action: string, amount: number): Promise<{ _id: string } | null>;
}

export interface MassModerationDeps {
  MassModerationModel: MassModerationModelLike;
  gate: MassModerationGate;
  publish: (guildId: string, message: string) => Promise<void>;
  recordAudit: (guildId: string, entry: { userId: string; action: string; details: string }) => Promise<void>;
  logger?: (level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) => void;
  now?: () => number;
}

export type MassModerationOutcome =
  | { kind: "guard-disabled" }
  | { kind: "raid-active" }
  | { kind: "below-threshold"; distinct: number }
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "already-sanctioned" }
  | { kind: "sanctioned"; targets: readonly string[]; liftedBans: number; failedBans: number };

const REASON = "Protectie moderation-guard: moderare in masa fara aprobare de tip moderation-mass";

export function createMassModerationRuntime(deps: MassModerationDeps) {
  const windows = createMassModerationRepository(deps.MassModerationModel);
  const now = deps.now ?? Date.now;

  async function rollbackBans(
    guild: MassModerationGuild,
    events: readonly MassModerationEvent[]
  ): Promise<{ lifted: number; failed: number }> {
    let lifted = 0;
    let failed = 0;
    for (const targetId of distinctTargets(events.filter(event => event.action === "ban"))) {
      const done = await guild.liftBan(targetId, REASON).catch(() => false);
      if (done) lifted += 1;
      else failed += 1;
    }
    return { lifted, failed };
  }

  async function sanction(
    guild: MassModerationGuild,
    actorId: string,
    events: readonly MassModerationEvent[]
  ): Promise<MassModerationOutcome> {
    const outcome = await executeElevatedRoleSanction({
      resolveActor: () => guild.resolveActor(actorId),
      botHighestRolePosition: guild.botHighestRolePosition,
      everyoneRoleId: guild.everyoneRoleId,
      reason: REASON
    });

    if (outcome.ownerInterventionRequired) {
      deps.logger?.("ERROR", "MASS_MODERATION", "Sanctiunea autorului nu s-a aplicat complet", {
        guildId: guild.id,
        actorId,
        blocked: outcome.blocked.length,
        failed: outcome.failed.length,
        verified: outcome.verified
      });
    }

    const bans = await rollbackBans(guild, events);
    const targets = distinctTargets(events);

    await deps.recordAudit(guild.id, {
      userId: actorId,
      action: "mass-moderation-sanctioned",
      details: `tinte=${targets.join(",")}; banuriRidicate=${bans.lifted}; banuriEsuate=${bans.failed}`
    }).catch(() => undefined);

    const lines = [
      `<@${actorId}> a moderat in masa fara aprobare.`,
      `Motiv: ${describeWindow(events)}, fara aprobare activa de tip moderation-mass`,
      bans.failed === 0
        ? bans.lifted > 0
          ? `Ban-urile au fost ridicate (${bans.lifted}); membrii trebuie reinvitati manual.`
          : "Nu existau ban-uri de ridicat; kick-urile nu pot fi anulate, membrii trebuie reinvitati manual."
        : `${bans.lifted} ban-uri ridicate, ${bans.failed} NU au putut fi ridicate; verificare manuala necesara.`,
      describeSanctionOutcome(outcome)
    ];
    await deps.publish(guild.id, lines.join("\n")).catch(() => undefined);

    return { kind: "sanctioned", targets, liftedBans: bans.lifted, failedBans: bans.failed };
  }

  async function handleModerationAction(
    guild: MassModerationGuild,
    actorId: string,
    input: { auditId: string; targetId: string; action: MassModerationAction }
  ): Promise<MassModerationOutcome> {
    const current = new Date(now());
    const situation = await deps.gate.readSituation(guild.id).catch(() => ({ guardEnabled: false, raidConfirmed: false }));
    if (!situation.guardEnabled) return { kind: "guard-disabled" };
    if (situation.raidConfirmed) return { kind: "raid-active" };
    if (guild.ownerId && actorId === guild.ownerId) return { kind: "allowed-owner" };

    const window = await windows.record(guild.id, actorId, input, current);
    const events = withinWindow(window.events, current);
    if (!breachesThreshold(events)) return { kind: "below-threshold", distinct: distinctTargets(events).length };

    const approval = await deps.gate
      .consumeApproval(guild.id, actorId, dominantAction(events), distinctTargets(events).length)
      .catch(() => null);
    if (approval) {
      await windows.clear(guild.id, actorId).catch(() => undefined);
      return { kind: "allowed-approval", requestId: approval._id };
    }

    const claimed = await windows.claimSanction(guild.id, actorId, current).catch(() => false);
    if (!claimed) return { kind: "already-sanctioned" };

    return sanction(guild, actorId, events);
  }

  return { handleModerationAction };
}

export interface MassModerationGatewayRuntime {
  handleModerationAction: (
    guild: MassModerationGuild,
    actorId: string,
    input: { auditId: string; targetId: string; action: MassModerationAction }
  ) => Promise<MassModerationOutcome>;
}
