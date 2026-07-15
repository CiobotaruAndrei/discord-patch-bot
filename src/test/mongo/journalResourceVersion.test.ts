import test from "node:test";
import assert from "node:assert/strict";
import { journalResourceVersion } from "../../features/admin-records/operationJournalRuntime.js";

const DISCORD_EPOCH_MS = 1420070400000;
const snowflakeForMs = (unixMs: number): string => ((BigInt(unixMs) - BigInt(DISCORD_EPOCH_MS)) << 22n).toString();

test("journalResourceVersion: id-ul de interactiune (snowflake) e pastrat identic, padat la 20 (backward-compatible cu intrarile existente)", () => {
  const id = "1234567890123456789";
  assert.equal(journalResourceVersion(id), id.padStart(20, "0"));
});

test("journalResourceVersion: snowflake-urile ordoneaza consistent dupa timp prin comparatie string pe versiunea padata", () => {
  const earlier = journalResourceVersion(snowflakeForMs(1_600_000_000_000));
  const later = journalResourceVersion(snowflakeForMs(2_000_000_000_000));
  assert.ok(later > earlier, "un snowflake mai nou produce o versiune mai mare (folosita in garda $gt de supersede)");
});

test("journalResourceVersion: fallback-ul traieste in ACELASI spatiu de ordonare ca snowflake-urile (review nou, Major #8)", () => {
  const earlier = journalResourceVersion(snowflakeForMs(1_600_000_000_000));
  const later = journalResourceVersion(snowflakeForMs(2_000_000_000_000));
  const realNow = Date.now;
  try {
    Date.now = () => 1_800_000_000_000;
    const fallback = journalResourceVersion(undefined);
    assert.ok(fallback > earlier, "fallback (mai nou) > snowflake mai vechi — acelasi spatiu, ordonare corecta");
    assert.ok(later > fallback, "snowflake mai nou > fallback mai vechi");
  } finally {
    Date.now = realNow;
  }
});

test("journalResourceVersion: fallback-ul NU mai e un Date.now() brut care ar sorta gresit inaintea oricarui snowflake (bug-ul de doua spatii incompatibile)", () => {
  const realNow = Date.now;
  try {
    Date.now = () => 1_800_000_000_000;
    const fallback = journalResourceVersion(undefined);
    assert.notEqual(fallback, String(1_800_000_000_000).padStart(20, "0"), "fallback-ul nu mai e Unix ms brut padat");
    const olderSnowflake = journalResourceVersion(snowflakeForMs(1_500_000_000_000));
    assert.ok(fallback > olderSnowflake, "un fallback mai nou sorteaza corect DUPA un snowflake mai vechi (cu bug-ul vechi, Unix ms brut ar fi sortat INAINTE, semnaland gresit operatia drept superseded)");
  } finally {
    Date.now = realNow;
  }
});
