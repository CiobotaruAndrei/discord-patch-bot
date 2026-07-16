import test from "node:test";
import assert from "node:assert/strict";

import { createThreatInspectionService } from "../../features/command-security/threatInspectionService.js";
import { isRecentAccount, recentAccountCutoff } from "../../features/command-security/recentAccountPolicy.js";

test("politica de cont nou foloseste exact trei luni calendaristice", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  assert.equal(recentAccountCutoff(now).toISOString(), "2026-04-30T12:00:00.000Z");
  assert.equal(isRecentAccount(new Date("2026-04-30T12:00:00.000Z").getTime(), now), true);
  assert.equal(isRecentAccount(new Date("2026-04-30T11:59:59.999Z").getTime(), now), false);
});

test("inspectia confirma executabilele prin continut chiar daca extensia lipseste", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => ({
      data: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      headers: { "content-type": "application/octet-stream" },
      status: 200
    })
  });

  const result = await inspector.inspectMessage("", [{
    id: "attachment-1",
    name: "document",
    url: "https://cdn.example.test/resource"
  }]);

  assert.equal(result.verdict, "confirmed");
  assert.match(result.reason, /executabila|script/);
});

test("inspectia recunoaste semnatura 7z si pastreaza documentele neconfirmate", async () => {
  const responses = [
    {
      data: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
      headers: { "content-type": "application/x-7z-compressed" },
      status: 200
    },
    {
      data: Buffer.from("%PDF-1.7"),
      headers: { "content-type": "application/pdf" },
      status: 200
    }
  ];
  const inspector = createThreatInspectionService({
    httpReq: async () => responses.shift() ?? { status: 404 }
  });

  const archive = await inspector.inspectMessage("https://example.test/archive", []);
  const document = await inspector.inspectMessage("https://example.test/document", []);

  assert.equal(archive.verdict, "uncertain");
  assert.equal(document.verdict, "uncertain");
});

test("o resursa care nu poate fi verificata ramane uncertain, nu este declarata periculoasa", async () => {
  const inspector = createThreatInspectionService({
    httpReq: async () => {
      throw new Error("network unavailable");
    }
  });

  const result = await inspector.inspectMessage("https://example.test/file", []);

  assert.equal(result.verdict, "uncertain");
  assert.match(result.reason, /nu a putut fi inspectata/);
});
