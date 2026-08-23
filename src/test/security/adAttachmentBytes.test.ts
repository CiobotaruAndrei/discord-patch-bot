import test from "node:test";
import assert from "node:assert/strict";

import { createAttachmentBytesReader } from "../../infra/http/attachmentBytes.js";
import { MAX_HASHED_ATTACHMENT_BYTES } from "../../features/command-security/adAttachmentHash.js";

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) { controller.close(); return; }
      controller.enqueue(chunks[index]);
      index += 1;
    }
  });
}

function respondWith(chunks: readonly Uint8Array[], contentLength: string | null): Response {
  const headers = new Headers();
  if (contentLength !== null) headers.set("content-length", contentLength);
  return new Response(streamOf(chunks), { status: 200, headers });
}

test("un raspuns care minte despre content-length e oprit in timpul citirii (review PR #967)", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const chunks = Array.from({ length: 12 }, () => chunk);
  let delivered = 0;

  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    delivered += 1;
    return respondWith(chunks, "10");
  };

  try {
    const bytes = await createAttachmentBytesReader()("https://cdn.example/mare.bin", 5_000);
    assert.equal(bytes, null, "plafonul trebuie sa margineasca memoria, nu doar sa creada antetul");
    assert.equal(delivered, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("un fisier sub plafon e citit integral (review PR #967)", async () => {
  const payload = new TextEncoder().encode("continut mic");
  const original = globalThis.fetch;
  globalThis.fetch = async () => respondWith([payload], String(payload.length));

  try {
    const bytes = await createAttachmentBytesReader()("https://cdn.example/mic.txt", 5_000);
    assert.deepEqual(bytes, payload);
  } finally {
    globalThis.fetch = original;
  }
});

test("un content-length declarat peste plafon nu se descarca deloc (review PR #967)", async () => {
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return respondWith([new Uint8Array(10)], String(MAX_HASHED_ATTACHMENT_BYTES + 1));
  };

  try {
    assert.equal(await createAttachmentBytesReader()("https://cdn.example/imens.bin", 5_000), null);
    assert.equal(called, true);
  } finally {
    globalThis.fetch = original;
  }
});
