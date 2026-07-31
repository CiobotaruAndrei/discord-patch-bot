import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";

const nativeSrc = path.join(process.cwd(), "native", "src");

const DOMAIN_MODULES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["inspection.rs", ["inspect_untrusted_content", "InspectionReportJs"]],
  ["magic.rs", ["inspect_magic", "MagicReportJs"]],
  ["yara.rs", ["scan_yara", "load_yara_rules", "yara_ruleset_info"]],
  ["urls.rs", ["analyze_url_host", "load_public_suffix_list", "public_suffix_info"]],
  ["shapes.rs", ["GameCandidate", "ListingCandidate", "SteamNewsItem", "to_game_data"]],
  ["text.rs", ["levenshtein", "clean_text", "stable_update_id", "deal_hash"]],
  ["ranking.rs", ["rank_listing_candidates", "select_latest_steam_patch_note", "dedupe_and_rank_deals"]],
  ["games.rs", ["find_game_keys", "build_autocomplete_choices"]]
];

function read(file: string): string {
  return fs.readFileSync(path.join(nativeSrc, file), "utf8");
}

test("fiecare domeniu N-API are modulul lui, cu functiile care il compun", () => {
  for (const [file, symbols] of DOMAIN_MODULES) {
    const source = read(file);
    const missing = symbols.filter(symbol => !source.includes(symbol));
    assert.deepEqual(missing, [], `${file} detine ${symbols.join(", ")}; lipsesc: ${missing.join(", ")}`);
  }
});

test("lib.rs ramane fatada: doar declara modulele si le reexporta", () => {
  const facade = read("lib.rs");
  assert.equal(
    facade.includes("#[napi"),
    false,
    "un `#[napi]` in lib.rs inseamna ca fisierul a inceput iar sa detina API, nu doar sa compuna"
  );
  const lines = facade.split("\n").map(line => line.trim()).filter(Boolean);
  const shape = lines.filter(line => !line.startsWith("mod ") && !line.startsWith("pub use "));
  assert.deepEqual(shape, [], "fatada nu are voie sa contina altceva decat `mod` si `pub use`: " + shape.join(" | "));
  for (const [file] of DOMAIN_MODULES) {
    const module = file.replace(".rs", "");
    assert.ok(facade.includes(`mod ${module};`), `fatada declara modulul ${module}`);
    assert.ok(facade.includes(`pub use ${module}::*;`), `fatada reexporta ${module}, ca suprafata addon-ului sa nu se schimbe`);
  }
});

test("niciun modul de domeniu nu creste inapoi cat fisierul din care a fost taiat", () => {
  const oversized: string[] = [];
  for (const [file] of DOMAIN_MODULES) {
    const lines = read(file).split("\n").length;
    if (lines > 200) oversized.push(`${file}: ${lines}`);
  }
  assert.deepEqual(
    oversized,
    [],
    "fisierul de dinainte avea 519 de linii cu 43 de exporturi N-API; un modul de domeniu care trece de 200 " +
      "de linii inseamna ca a inceput sa adune iar mai multe domenii: " + oversized.join(", ")
  );
});
