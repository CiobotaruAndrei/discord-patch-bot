"use strict";

import { createHash } from "crypto";

export const MAX_HASHED_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_HASH_TIMEOUT_MS = 5_000;

export type FetchAttachmentBytes = (url: string, timeoutMs: number) => Promise<Uint8Array | null>;

export interface HashableAttachment {
  url?: string | null;
  size?: number | null;
}

export function tooLargeToHash(attachment: HashableAttachment | null): boolean {
  const size = attachment?.size;
  return typeof size === "number" && Number.isFinite(size) && size > MAX_HASHED_ATTACHMENT_BYTES;
}

export async function hashAttachment(
  attachment: HashableAttachment | null,
  fetchBytes: FetchAttachmentBytes
): Promise<string | null> {
  const url = attachment?.url;
  if (!attachment || typeof url !== "string" || !url) return null;
  if (tooLargeToHash(attachment)) return null;

  const bytes = await fetchBytes(url, ATTACHMENT_HASH_TIMEOUT_MS).catch(() => null);
  if (!bytes || bytes.length === 0) return null;
  if (bytes.length > MAX_HASHED_ATTACHMENT_BYTES) return null;

  return createHash("sha256").update(bytes).digest("hex");
}
