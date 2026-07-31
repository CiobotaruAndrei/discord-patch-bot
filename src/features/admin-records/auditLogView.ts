"use strict";

import type { BotAuditLogEntry, ServerAuditLogEntry } from "./adminRecordsTypes.js";
import { clampJoinedList } from "../command-presentation/discordListLimit.js";
import { escapeInlineText } from "../../shared/discordText.js";

const LIST_BUDGET = 1900;
const MESSAGE_BUDGET = 1990;

export function formatAuditDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data necunoscuta";
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

export function formatUserReference(userId: string): string {
  return userId ? `<@${userId}>` : "user necunoscut";
}

export function renderBotLog(entries: BotAuditLogEntry[]): string {
  if (!entries.length) return "Nu exista actiuni admin salvate pentru acest server.";
  const lines = entries.map(entry => [
    `- ${formatAuditDate(entry.at)} ${formatUserReference(entry.userId || "")}`,
    `comanda: \`${entry.command}\``,
    `rezultat: ${escapeInlineText(entry.result, 200)}`,
    entry.details ? `detalii: ${escapeInlineText(entry.details, 400)}` : ""
  ].filter(Boolean).join(" | "));
  return `Bot log (${entries.length}):\n${clampJoinedList(lines, LIST_BUDGET)}`;
}

export function renderServerLog(entries: ServerAuditLogEntry[]): string {
  if (!entries.length) return "Nu exista schimbari importante salvate pentru acest server.";
  const lines = entries.map(entry => [
    `- ${formatAuditDate(entry.at)} actor: ${formatUserReference(entry.actorId || entry.userId || "")}`,
    entry.targetId ? `tinta: ${formatUserReference(entry.targetId)}` : "",
    `actiune: \`${entry.action}\``,
    entry.details ? `detalii: ${escapeInlineText(entry.details, 400)}` : ""
  ].filter(Boolean).join(" | "));
  return `Server log (${entries.length}):\n${clampJoinedList(lines, LIST_BUDGET)}`;
}

export function fitDeliveryMessage(header: string, rendered: string, status: string): string {
  const fixed = `${header}\n${status}\n`;
  const room = Math.max(0, MESSAGE_BUDGET - fixed.length);
  return `${fixed}${rendered.slice(0, room)}`;
}
