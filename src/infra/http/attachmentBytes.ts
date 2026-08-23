"use strict";

import { MAX_HASHED_ATTACHMENT_BYTES } from "../../features/command-security/adAttachmentHash.js";

import type { FetchAttachmentBytes } from "../../features/command-security/adAttachmentHash.js";

async function readBounded(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > MAX_HASHED_ATTACHMENT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function createAttachmentBytesReader(): FetchAttachmentBytes {
  return async (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_HASHED_ATTACHMENT_BYTES) return null;
      return await readBounded(response.body);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
