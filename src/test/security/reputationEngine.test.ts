import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createReputationEngine, resolveReputationEngineStatus } from "../../features/command-security/reputationEngine.js";

const SCAN_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
const SCAN_SHA256 = createHash("sha256").update(SCAN_BYTES).digest("hex");
const SCAN_INPUT = { url: "https://cdn.example.test/file", mime: "application/octet-stream", buffer: SCAN_BYTES, kind: "executable" as const };

test("motor neconfigurat (fara URL) => null si status not-configured (audit, #21)", () => {
  assert.equal(createReputationEngine({ env: {}, httpReq: async () => ({ data: "malware" }) }), null);
  const status = resolveReputationEngineStatus({});
  assert.equal(status.configured, false);
  assert.match(status.reason, /neconfigurat/);
});

test("validare la boot: URL non-https si token prea scurt sunt respinse (audit, #21)", () => {
  assert.equal(resolveReputationEngineStatus({ THREAT_REPUTATION_URL: "http://insecure.example/scan" }).configured, false, "http:// e respins");
  assert.equal(resolveReputationEngineStatus({ THREAT_REPUTATION_URL: "not a url" }).configured, false);
  assert.equal(resolveReputationEngineStatus({ THREAT_REPUTATION_URL: "https://ok.example/scan", THREAT_REPUTATION_TOKEN: "short" }).configured, false, "token < 8 caractere respins");
  assert.equal(resolveReputationEngineStatus({ THREAT_REPUTATION_URL: "https://ok.example/scan", THREAT_REPUTATION_TOKEN: "long-enough-token" }).configured, true);
  assert.equal(resolveReputationEngineStatus({ THREAT_REPUTATION_URL: "https://ok.example/scan" }).configured, true, "URL https fara token e valid");
});

test("motor configurat cheama endpoint-ul cu token si intoarce verdictul normalizat (audit, #21)", async () => {
  const calls: Array<{ method: string; url: string; options?: Record<string, unknown> }> = [];
  const engine = createReputationEngine({
    env: { THREAT_REPUTATION_URL: "https://rep.example/scan", THREAT_REPUTATION_TOKEN: "long-enough-token" },
    httpReq: async (method, url, options) => {
      calls.push({ method, url, options });
      return { data: { verdict: "malware", contentSha256: SCAN_SHA256 }, status: 200 };
    }
  });
  assert.ok(engine);

  const verdict = await engine!(SCAN_INPUT);

  assert.equal(verdict, "malware");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://rep.example/scan");
  const headers = (calls[0].options?.headers ?? {}) as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer long-enough-token", "tokenul e trimis ca Bearer, nu logat");
  assert.deepEqual(calls[0].options?.data, {
    url: SCAN_INPUT.url,
    mime: SCAN_INPUT.mime,
    kind: SCAN_INPUT.kind,
    contentBase64: SCAN_BYTES.toString("base64"),
    contentLength: SCAN_BYTES.length,
    contentSha256: SCAN_SHA256
  });
});

test("verdict/clean/unknown si HTTP 4xx/eroare degradeaza la unknown, nu la malware (audit, #21)", async () => {
  const engineClean = createReputationEngine({ env: { THREAT_REPUTATION_URL: "https://rep.example/scan" }, httpReq: async () => ({ data: { verdict: "clean", contentSha256: SCAN_SHA256 }, status: 200 }) });
  assert.equal(await engineClean!(SCAN_INPUT), "clean");

  const engineWeird = createReputationEngine({ env: { THREAT_REPUTATION_URL: "https://rep.example/scan" }, httpReq: async () => ({ data: { verdict: "???", contentSha256: SCAN_SHA256 }, status: 200 }) });
  assert.equal(await engineWeird!(SCAN_INPUT), "unknown", "un verdict necunoscut => unknown, nu malware");

  const engine4xx = createReputationEngine({ env: { THREAT_REPUTATION_URL: "https://rep.example/scan" }, httpReq: async () => ({ data: { verdict: "malware", contentSha256: SCAN_SHA256 }, status: 403 }) });
  assert.equal(await engine4xx!(SCAN_INPUT), "unknown", "un raspuns 4xx nu produce malware fals");

  const engineThrows = createReputationEngine({ env: { THREAT_REPUTATION_URL: "https://rep.example/scan" }, httpReq: async () => { throw new Error("down"); } });
  assert.equal(await engineThrows!(SCAN_INPUT), "unknown", "un motor cazut => unknown, nu malware");
});

test("verdictul extern fara bytes locali sau cu hash diferit nu poate confirma continutul (audit conformitate, #24)", async () => {
  const mismatch = createReputationEngine({
    env: { THREAT_REPUTATION_URL: "https://rep.example/scan" },
    httpReq: async () => ({ data: { verdict: "malware", contentSha256: "0".repeat(64) }, status: 200 })
  });
  assert.equal(await mismatch!(SCAN_INPUT), "unknown");

  const unbound = createReputationEngine({
    env: { THREAT_REPUTATION_URL: "https://rep.example/scan" },
    httpReq: async () => ({ data: { verdict: "malware", contentSha256: SCAN_SHA256 }, status: 200 })
  });
  assert.equal(await unbound!({ ...SCAN_INPUT, buffer: null }), "unknown");
});

test("motorul extern accepta categoriile confirmate numai cu hash-ul exact", async () => {
  const payload = Buffer.from("pagina-falsa");
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  const scan = createReputationEngine({
    env: { THREAT_REPUTATION_URL: "https://scanner.example.test" },
    httpReq: async () => ({ status: 200, data: { verdict: "phishing", contentSha256: expectedHash } })
  });
  assert.ok(scan);
  assert.equal(await scan({ mime: "text/html", buffer: payload, kind: "other" }), "phishing");
});
