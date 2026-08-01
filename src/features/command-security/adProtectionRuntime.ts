"use strict";

import { createAdProtectionRepository } from "./adProtectionRepository.js";
import { adFingerprint, describeStrike, detectAd } from "./adRequestTypes.js";

import type { AdAttemptModelLike, AdRequestModelLike } from "./adProtectionRepository.js";
import type { StrikeOutcome } from "./adRequestTypes.js";

export interface AdMessage {
  guildId: string;
  authorId: string;
  authorTag: string;
  bot: boolean;
  channelId: string | null;
  content: string;
  attachmentUrl: string | null;
  attachmentCount: number;
  deleteMessage: () => Promise<unknown>;
}

export interface AdProtectionRuntimeDeps {
  AdRequestModel: AdRequestModelLike;
  AdAttemptModel: AdAttemptModelLike;
  readGuildSettings: (guildId: string) => Promise<{ adAlertChannelId?: string | null; adProtectionEnabled?: boolean } | null>;
  readOwnerId: (guildId: string) => string | null;
  isRaidConfirmed?: (guildId: string) => Promise<boolean>;
  issueWarn: (guildId: string, userId: string, username: string, reason: string) => Promise<{ count: number; limit: number } | null>;
  publish: (guildId: string, body: string) => Promise<unknown>;
  logger?: (level: string, scope: string, message: string, detail?: Record<string, unknown>) => void;
  now?: () => number;
}

export type AdOutcome =
  | { kind: "protection-off" }
  | { kind: "raid-active" }
  | { kind: "not-an-ad" }
  | { kind: "allowed-owner" }
  | { kind: "allowed-approval"; requestId: string }
  | { kind: "deleted"; outcome: StrikeOutcome; warned: boolean; deleteFailed: boolean };

export function createAdProtectionRuntime(deps: AdProtectionRuntimeDeps) {
  const repository = createAdProtectionRepository(deps.AdRequestModel, deps.AdAttemptModel);
  const now = deps.now ?? Date.now;

  async function handleMessage(message: AdMessage): Promise<AdOutcome> {
    if (!message.authorId) return { kind: "not-an-ad" };

    const settings = await deps.readGuildSettings(message.guildId).catch(() => null);
    if (settings?.adProtectionEnabled !== true) return { kind: "protection-off" };

    if (deps.isRaidConfirmed && await deps.isRaidConfirmed(message.guildId).catch(() => false)) {
      return { kind: "raid-active" };
    }

    const detection = detectAd(message.content, message.attachmentCount);
    if (!detection.isAd) return { kind: "not-an-ad" };

    if (deps.readOwnerId(message.guildId) === message.authorId) return { kind: "allowed-owner" };

    const fingerprint = adFingerprint(message.content, message.attachmentUrl);
    const approval = await repository
      .consumeApproval(message.guildId, message.authorId, fingerprint, new Date(now()))
      .catch(() => null);
    if (approval) return { kind: "allowed-approval", requestId: approval._id };

    let deleteFailed = false;
    await message.deleteMessage().catch(error => {
      deleteFailed = true;
      deps.logger?.("WARN", "AD_PROTECTION", "Reclama nu a putut fi stearsa", {
        guildId: message.guildId,
        authorId: message.authorId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    const outcome = await repository.recordAttempt(
      message.guildId,
      message.authorId,
      message.channelId,
      detection.reasons.join("; "),
      new Date(now())
    );

    let warned = false;
    if (outcome.kind === "warn-issued") {
      const result = await deps
        .issueWarn(message.guildId, message.authorId, message.authorTag, "Reclame neautorizate: 3 tentative")
        .catch(() => null);
      warned = result !== null;
      if (!warned) {
        deps.logger?.("ERROR", "AD_PROTECTION", "Warn-ul automat nu a putut fi emis", {
          guildId: message.guildId,
          authorId: message.authorId
        });
      }
    }

    const suffix = deleteFailed ? " Mesajul NU a putut fi sters; verificare manuala necesara." : "";
    const warnNote = outcome.kind === "warn-issued" && !warned
      ? " Warn-ul automat NU a putut fi emis; verificare manuala necesara."
      : "";
    await deps
      .publish(
        message.guildId,
        `<@${message.authorId}> — ${describeStrike(outcome)} Motiv: ${detection.reasons.join("; ")}.${suffix}${warnNote}`
      )
      .catch(() => undefined);

    return { kind: "deleted", outcome, warned, deleteFailed };
  }

  async function stopProtection(guildId: string): Promise<void> {
    await repository.cancelActiveRequests(guildId).catch(() => undefined);
  }

  return { handleMessage, stopProtection };
}

export type AdProtectionRuntime = ReturnType<typeof createAdProtectionRuntime>;
