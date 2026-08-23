"use strict";

import { MAX_HASHED_ATTACHMENT_BYTES } from "../../features/command-security/adAttachmentHash.js";

import type { FetchAttachmentBytes } from "../../features/command-security/adAttachmentHash.js";

export function createAttachmentBytesReader(): FetchAttachmentBytes {
  return async (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_HASHED_ATTACHMENT_BYTES) return null;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_HASHED_ATTACHMENT_BYTES) return null;
      return new Uint8Array(buffer);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
