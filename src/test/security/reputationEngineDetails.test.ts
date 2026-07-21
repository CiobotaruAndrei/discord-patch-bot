import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createReputationEngine,
  readEngineText,
  type ReputationEngineDetails
} from "../../features/command-security/reputationEngine.js";

const ENV = { THREAT_REPUTATION_URL: "https://gateway.example.test/scan", THREAT_REPUTATION_TOKEN: "token-suficient" };

function engineWith(responseData: unknown) {
  const captured: ReputationEngineDetails[] = [];
  const scan = createReputationEngine({
    env: ENV,
    httpReq: async () => ({ data: responseData, status: 200 }),
    onDetails: details => { captured.push(details); }
  });
  return { scan, captured };
}

function shaOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

test("semnatura si versiunile motorului antivirus ajung in auditul local", async () => {
  const buffer = Buffer.from("continut de test", "latin1");
  const { scan, captured } = engineWith({
    verdict: "malware",
    contentSha256: shaOf(buffer),
    signature: "Win.Test.EICAR_HDB-1",
    engineVersion: "1.4.2",
    dbVersion: "27234"
  });
  assert.ok(scan);

  const verdict = await scan({ buffer, mime: "application/octet-stream", kind: "other", complete: true });

  assert.equal(verdict, "malware");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].signature, "Win.Test.EICAR_HDB-1");
  assert.equal(captured[0].engineVersion, "1.4.2");
  assert.equal(captured[0].databaseVersion, "27234");
  assert.equal(captured[0].contentSha256, shaOf(buffer), "detaliile raman legate de hash-ul exact al continutului");
});

test("un raspuns fara metadate nu inventeaza valori", async () => {
  const buffer = Buffer.from("alt continut", "latin1");
  const { scan, captured } = engineWith({ verdict: "clean", contentSha256: shaOf(buffer) });
  assert.ok(scan);

  await scan({ buffer, mime: "text/plain", kind: "other", complete: true });

  assert.equal(captured[0].signature, "");
  assert.equal(captured[0].engineVersion, "");
  assert.equal(captured[0].databaseVersion, "");
});

test("detaliile poarta si daca obiectul scanat a fost complet", async () => {
  const buffer = Buffer.from("fragment", "latin1");
  const { scan, captured } = engineWith({ verdict: "clean", contentSha256: shaOf(buffer) });
  assert.ok(scan);

  await scan({ buffer, mime: "application/zip", kind: "other", complete: false });

  assert.equal(captured[0].complete, false, "auditul stie ca verdictul s-a dat pe un fragment");
});

test("un hash care nu corespunde continutului nu poate produce un verdict util", async () => {
  const buffer = Buffer.from("continut real", "latin1");
  const { scan, captured } = engineWith({ verdict: "clean", contentSha256: "hash-strain", signature: "Ceva" });
  assert.ok(scan);

  const verdict = await scan({ buffer, mime: "text/plain", kind: "other", complete: true });

  assert.equal(verdict, "unknown", "legarea de hash ramane singura sursa de adevar");
  assert.equal(captured[0].verdict, "unknown", "auditul consemneaza verdictul efectiv, nu cel pretins de raspuns");
});

test("campurile de text din raspuns sunt plafonate, nu preluate oricat de lungi", () => {
  const long = "x".repeat(5000);
  assert.equal(readEngineText({ signature: long }, "signature").length, 200);
  assert.equal(readEngineText({ signature: 42 }, "signature"), "");
  assert.equal(readEngineText(null, "signature"), "");
});
