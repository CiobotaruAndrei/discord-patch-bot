"use strict";

import globalAccessCode from "./globalAccessCode.js";
import { commandAuditName, guildIdOf } from "./adminAccessResolver.js";
import type {
  AdminCommandGuardContext,
  AdminGuardInteraction,
  AdminGuardPayload,
  DefaultRequireGuildAdmin,
  ModalSubmitLike
} from "./adminGuardContracts.js";

import {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} from "discord.js";

import defaultRequireGuildAdminModule from "./adminPermissionGuard.js";
const defaultRequireGuildAdmin = defaultRequireGuildAdminModule as DefaultRequireGuildAdmin;

const ACCESS_CODE_MODAL_INPUT_ID = "access-code";
const ACCESS_CODE_MODAL_TIMEOUT_MS = 60_000;
const ACCESS_CODE_LOCK_MS = 15 * 60_000;
const ACCESS_CODE_FAILURE_WINDOW_MS = 10 * 60_000;
const ACCESS_CODE_MAX_FAILURES = 5;
const accessCodeFailures = new Map<string, { count: number; firstFailedAt: number; lockedUntil: number; alertSent: boolean }>();

export async function replyEphemeral(interaction: AdminGuardInteraction | ModalSubmitLike, content: string): Promise<void> {
  const payload: AdminGuardPayload = { content, flags: MessageFlags.Ephemeral };
  if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
    await interaction.followUp(payload);
    return;
  }
  if (typeof interaction.reply === "function") await interaction.reply(payload);
}

function accessFailureKey(interaction: AdminGuardInteraction): string {
  return `${guildIdOf(interaction)}:${interaction.user?.id || ""}`;
}

function activeFailureState(key: string, nowMs: number) {
  const state = accessCodeFailures.get(key);
  if (!state) return null;
  if (state.lockedUntil > nowMs) return state;
  if (state.firstFailedAt + ACCESS_CODE_FAILURE_WINDOW_MS < nowMs) {
    accessCodeFailures.delete(key);
    return null;
  }
  return state;
}

export function clearAccessCodeFailures(interaction: AdminGuardInteraction): void {
  accessCodeFailures.delete(accessFailureKey(interaction));
}

export async function recordAccessCodeFailure(target: AdminCommandGuardContext, interaction: AdminGuardInteraction): Promise<void> {
  const key = accessFailureKey(interaction);
  if (!interaction.user?.id || !guildIdOf(interaction)) return;
  const nowMs = Date.now();
  const current = activeFailureState(key, nowMs);
  const next = current || { count: 0, firstFailedAt: nowMs, lockedUntil: 0, alertSent: false };
  next.count += 1;
  if (next.count >= ACCESS_CODE_MAX_FAILURES) next.lockedUntil = nowMs + ACCESS_CODE_LOCK_MS;
  accessCodeFailures.set(key, next);
  if (next.lockedUntil > nowMs && !next.alertSent) {
    next.alertSent = true;
    await target.adminAlert?.(
      "security:access-code",
      "Incercari esuate pentru codul de acces global",
      `User ${interaction.user.id} a introdus codul global gresit de ${next.count} ori pentru ${commandAuditName(interaction)}.`,
      guildIdOf(interaction)
    ).catch(() => undefined);
  }
}

export function isAccessCodeLocked(interaction: AdminGuardInteraction): boolean {
  return Boolean(activeFailureState(accessFailureKey(interaction), Date.now())?.lockedUntil);
}

export async function promptGlobalAccessCode<T extends AdminGuardInteraction>(target: AdminCommandGuardContext, interaction: T): Promise<T | null> {
  if (isAccessCodeLocked(interaction)) {
    await replyEphemeral(interaction, "Access denied.");
    return null;
  }
  if (typeof interaction.showModal !== "function" || typeof interaction.awaitModalSubmit !== "function") {
    await defaultRequireGuildAdmin.rejectNonAdmin(interaction);
    return null;
  }
  const userId = interaction.user?.id || "";
  if (!userId) {
    await defaultRequireGuildAdmin.rejectNonAdmin(interaction);
    return null;
  }
  const customId = `global-access-code:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const input = new TextInputBuilder()
    .setCustomId(ACCESS_CODE_MODAL_INPUT_ID)
    .setLabel("Cod de acces")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(128);
  const row = new ActionRowBuilder<InstanceType<typeof TextInputBuilder>>().addComponents(input);
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Cod acces admin")
    .addComponents(row);
  await interaction.showModal(modal);
  const submit = await interaction.awaitModalSubmit({
    time: ACCESS_CODE_MODAL_TIMEOUT_MS,
    filter: modalInteraction => modalInteraction.customId === customId && modalInteraction.user?.id === userId
  }).catch(() => null);
  if (!submit) return null;
  const candidate = submit.fields?.getTextInputValue?.(ACCESS_CODE_MODAL_INPUT_ID) || "";
  const result = globalAccessCode.verifyGlobalAccessCode(candidate, target?.env ?? process.env);
  if (result !== "valid") {
    await recordAccessCodeFailure(target, interaction);
    await replyEphemeral(submit, "Access denied.");
    return null;
  }
  clearAccessCodeFailures(interaction);
  await replyEphemeral(submit, "Access granted.");
  return {
    ...interaction,
    globalAccessCodeAuthorized: true,
    deferred: submit.deferred,
    replied: submit.replied,
    reply: submit.reply?.bind(submit),
    followUp: submit.followUp?.bind(submit),
    deferReply: submit.deferReply?.bind(submit),
    editReply: submit.editReply?.bind(submit)
  };
}
