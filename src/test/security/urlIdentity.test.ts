import test from "node:test";
import assert from "node:assert/strict";

import { getNativeFuzzy, isRustFuzzyAvailable } from "../../native/fuzzy.js";
import type { NativeSuffixListInfo, NativeUrlIdentityReport } from "../../native/fuzzyNativeBridge.js";

const LIST = "// ===BEGIN ICANN DOMAINS===\ncom\nnet\norg\nuk\nco.uk\n// ===END ICANN DOMAINS===\n";
const BRANDS = ["discord", "steam"];

interface UrlIdentityApi {
  loadPublicSuffixList(source: string): NativeSuffixListInfo;
  analyzeUrlHost(host: string, brands: string[]): NativeUrlIdentityReport;
}

function native(): UrlIdentityApi | null {
  const fuzzy = getNativeFuzzy();
  const load = fuzzy?.loadPublicSuffixList;
  const analyze = fuzzy?.analyzeUrlHost;
  if (!fuzzy || typeof load !== "function" || typeof analyze !== "function") return null;
  return {
    loadPublicSuffixList: source => load.call(fuzzy, source),
    analyzeUrlHost: (host, brands) => analyze.call(fuzzy, host, brands)
  };
}

const engineReady = isRustFuzzyAvailable() && native() !== null;

test("lista de sufixe publice se incarca si isi raporteaza identitatea pentru cheia de cache", { skip: !engineReady }, () => {
  const fuzzy = native();
  assert.ok(fuzzy);
  const info = fuzzy.loadPublicSuffixList(LIST);
  assert.equal(info.loaded, true);
  assert.ok(info.listId.length > 0, "identitatea listei intra in cheia de cache");
});

test("un subdomeniu care imita un brand nu e confundat cu domeniul brandului", { skip: !engineReady }, () => {
  const fuzzy = native();
  assert.ok(fuzzy);
  fuzzy.loadPublicSuffixList(LIST);

  const report = fuzzy.analyzeUrlHost("login.discord.example.com", BRANDS);
  assert.equal(report.registrableDomain, "example.com");
  assert.ok(
    report.indicators.some(entry => /subdomeniu/.test(entry)),
    `numele brandului intr-un subdomeniu e semnalat: ${JSON.stringify(report.indicators)}`
  );
});

test("domeniul propriu al brandului nu produce niciun indicator", { skip: !engineReady }, () => {
  const fuzzy = native();
  assert.ok(fuzzy);
  fuzzy.loadPublicSuffixList(LIST);

  const report = fuzzy.analyzeUrlHost("cdn.discord.com", BRANDS);
  assert.equal(report.registrableDomain, "discord.com");
  assert.deepEqual(report.indicators, [], "politica nu trebuie sa devina o sursa de fals pozitive");
});

test("un homograf pastreaza ambele forme ale host-ului si e semnalat", { skip: !engineReady }, () => {
  const fuzzy = native();
  assert.ok(fuzzy);
  fuzzy.loadPublicSuffixList(LIST);

  const report = fuzzy.analyzeUrlHost("disсord.com", BRANDS);
  assert.ok(report.hostPunycode.includes("xn--"), `forma Punycode e pastrata: ${report.hostPunycode}`);
  assert.notEqual(report.hostUnicode, report.hostPunycode, "ambele forme calatoresc in raport");
  assert.ok(report.indicators.length > 0, JSON.stringify(report.indicators));
});
