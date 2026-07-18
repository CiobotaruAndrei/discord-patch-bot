"use strict";

export interface DirectAttachment {
  id?: string;
  name?: string | null;
  url?: string;
  contentType?: string | null;
  size?: number;
}

import { containsExternalLink, validateUserText } from "../command-security/userTextPolicy.js";
export { containsExternalLink };

export function attachmentLabel(attachment: DirectAttachment | null | undefined): string {
  const name = attachment?.name?.trim();
  return name ? ` [atasament: ${name}]` : "";
}

export function validateModerationText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = validateUserText("moderation.reason", value);
  if (!trimmed) return null;
  return trimmed;
}

export default { containsExternalLink, attachmentLabel, validateModerationText };
