import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SOURCE_RETRIES,
  DEFAULT_SOURCE_RETRY_DELAY_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
  SOURCE_POLICIES,
  requestOptionsFor,
  type SourcePolicyId
} from "../sources/sourcePolicies.js";

import fs from "fs";
import path from "path";

const POLICY_WIRED_FETCHERS = [
  "sources/steam/index.ts",
  "sources/deals/steamDeals.ts",
  "sources/deals/epicDeals.ts",
  "sources/deals/dealEnrichment.ts",
  "sources/updates/listingUpdates.ts",
  "sources/updates/platformUpdates.ts",
  "features/youtube/youtubeSource.ts"
];

test("politicile per sursa sunt marginite si complete (R7 #10)", () => {
  const ids = Object.keys(SOURCE_POLICIES);
  assert.ok(ids.length >= 10, "toate sursele externe au politica explicita");
  for (const id of ids) {
    const policy = SOURCE_POLICIES[id as SourcePolicyId];
    assert.ok(policy.timeoutMs >= 1000 && policy.timeoutMs <= 30000, `${id}: timeout marginit (${policy.timeoutMs}ms)`);
    assert.ok(policy.retries >= 0 && policy.retries <= 5, `${id}: retries marginit`);
    assert.ok(policy.retryDelayMs >= 100, `${id}: retry delay rezonabil`);
    assert.ok(["fail-open", "fail-closed"].includes(policy.failMode), `${id}: failMode definit`);
    assert.ok(["html", "json-large"].includes(policy.contentBudget), `${id}: buget de continut definit`);
  }
});

test("politicile pastreaza valorile decise anterior: enrichment/articolul de listing mai stranse, reviews cu retry propriu, fortnite prin proxy", () => {
  assert.equal(SOURCE_POLICIES["deal-enrichment-appdetails"].timeoutMs, 5000, "enrichment-ul are timeout mai strans decat default-ul");
  assert.equal(SOURCE_POLICIES["listing-article"].timeoutMs, 8000, "articolele de listing au timeout mai strans decat default-ul");
  assert.ok(SOURCE_POLICIES["deal-enrichment-appdetails"].timeoutMs < DEFAULT_SOURCE_TIMEOUT_MS);
  assert.equal(SOURCE_POLICIES["steam-reviews"].retries, 3);
  assert.equal(SOURCE_POLICIES["steam-reviews"].retryDelayMs, 800);
  assert.equal(SOURCE_POLICIES["steam-reviews"].failMode, "fail-open", "reviews degradeaza la success:false, nu opreste sursa");
  const proxied = (Object.keys(SOURCE_POLICIES) as SourcePolicyId[]).filter(id => SOURCE_POLICIES[id].viaProxy);
  assert.deepEqual(proxied, ["platform-fortnite-blog"], "singura sursa prin proxy e blogul Fortnite");
  assert.equal(SOURCE_POLICIES["deal-enrichment-appdetails"].failMode, "fail-open", "enrichment-ul esuat pastreaza deal-ul de baza");
  assert.equal(SOURCE_POLICIES["listing-index"].failMode, "fail-closed", "esecul index-ului de listing se propaga la circuit breaker");
});

test("requestOptionsFor deriva optiunile httpReq din politica (timeout + bugetul de continut)", () => {
  assert.deepEqual(requestOptionsFor("steam-appdetails"), { timeout: DEFAULT_SOURCE_TIMEOUT_MS, largeJson: true });
  assert.deepEqual(requestOptionsFor("listing-article"), { timeout: 8000 });
  assert.deepEqual(requestOptionsFor("deal-enrichment-appdetails"), { timeout: 5000, largeJson: true });
  assert.equal(DEFAULT_SOURCE_RETRIES, 2);
  assert.equal(DEFAULT_SOURCE_RETRY_DELAY_MS, 1000);
});

test("gard: fetcher-ele folosesc politicile centralizate, fara timeout-uri sau bugete hardcodate per apel", () => {
  const srcRoot = process.cwd();
  for (const rel of POLICY_WIRED_FETCHERS) {
    const source = fs.readFileSync(path.join(srcRoot, rel), "utf8");
    assert.ok(source.includes("requestOptionsFor("), `${rel} isi ia optiunile de request din sourcePolicies`);
    assert.ok(!/timeout:\s*\d/.test(source), `${rel} nu mai are timeout numeric hardcodat`);
    assert.ok(!source.includes("largeJson: true"), `${rel} nu mai seteaza manual bugetul de continut`);
  }
});
