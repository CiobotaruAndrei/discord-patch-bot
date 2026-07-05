"use strict";

export const MAX_NOTIFICATION_TEMPLATE_LENGTH = 500;

export function normalizeNotificationTemplate(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NOTIFICATION_TEMPLATE_LENGTH);
}

export interface NotificationTemplateVars {
  count: number;
}

export function renderNotificationTemplate(
  template: string | null | undefined,
  vars: NotificationTemplateVars
): string | null {
  const normalized = normalizeNotificationTemplate(template);
  if (!normalized) return null;
  return normalized.replaceAll("{count}", String(Math.max(0, Math.trunc(vars.count))));
}

export function buildNotificationContent(
  template: string | null | undefined,
  vars: NotificationTemplateVars,
  roleId: string | null | undefined
): { content?: string; allowedMentions?: { roles: string[] } } {
  const rendered = renderNotificationTemplate(template, vars);
  const mention = roleId ? `<@&${roleId}>` : "";
  const content = [rendered, mention].filter(Boolean).join(" ").trim();
  if (!content) return {};
  return roleId
    ? { content, allowedMentions: { roles: [roleId] } }
    : { content };
}
