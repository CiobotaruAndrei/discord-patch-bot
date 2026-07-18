"use strict";

export type UserTextPolicy = "text-no-links" | "identifier" | "explicit-url" | "attachment";

export const USER_TEXT_FIELD_POLICIES = Object.freeze({
  "moderation.reason": "text-no-links",
  "report.bug.description": "text-no-links",
  "report.complaint.reason": "text-no-links",
  "suggest-command.name": "identifier",
  "suggest-command.description": "text-no-links",
  "game-alias.alias": "identifier",
  "template.text": "text-no-links",
  "youtube.message-template": "text-no-links",
  "youtube.channel-reference": "explicit-url",
  "moderation.attachment": "attachment"
} satisfies Record<string, UserTextPolicy>);

export type UserTextField = keyof typeof USER_TEXT_FIELD_POLICIES;

const LINK_PATTERN = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bdiscord(?:app)?\.com\/invite\/|\bdiscord\.gg\/|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?)/i;

export function containsExternalLink(value: string): boolean {
  return LINK_PATTERN.test(value);
}

export function validateUserText(field: UserTextField, value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const policy = USER_TEXT_FIELD_POLICIES[field];
  if (!normalized) return "";
  if ((policy === "text-no-links" || policy === "identifier") && containsExternalLink(normalized)) {
    throw new Error("Campul nu poate contine linkuri. Incarca dovezile ca atasament direct cand comanda permite acest lucru.");
  }
  return normalized;
}

export default { USER_TEXT_FIELD_POLICIES, containsExternalLink, validateUserText };
