"use strict";

export interface DirectAttachment {
  id?: string;
  name?: string | null;
  url?: string;
  contentType?: string | null;
  size?: number;
}

const LINK_PATTERN = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\bdiscord(?:app)?\.com\/invite\/|\bdiscord\.gg\/|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?)/i;

export function containsExternalLink(value: string): boolean {
  return LINK_PATTERN.test(value);
}

export function attachmentLabel(attachment: DirectAttachment | null | undefined): string {
  const name = attachment?.name?.trim();
  return name ? ` [atasament: ${name}]` : "";
}

export function validateModerationText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (containsExternalLink(trimmed)) throw new Error("Motivul nu poate contine linkuri. Incarca fisierul direct ca atasament.");
  return trimmed;
}

export default { containsExternalLink, attachmentLabel, validateModerationText };
