# Benchmarks & decizii de performanta

Documentul aduna masuratori reproductibile pentru zonele sensibile la performanta si
deciziile de design care decurg din ele (in special: ce sta in Rust si ce sta in
TypeScript, conform regulii „nu se scoate o bucata de limbaj decat daca inlocuitorul
face botul mai bun si mai eficient").

Rerulare:

```bash
cd src
npm run benchmark:cpu      # native vs TS pentru hot-path-urile CPU
npm run benchmark:outbox   # drenare outbox job-by-job pe Mongo real (MONGO_URI)
npm run benchmark          # scalare notificari (update-uri/reduceri) pe 100/500/1000 guild-uri
```

Cifrele de mai jos sunt orientative (masinile difera); ce conteaza este raportul si forma
scalarii, nu valoarea absoluta.

## 1. CPU hot-path: fuzzy matching (Rust vs TypeScript)

`npm run benchmark:cpu` masoara `levenshtein` (folosit la fiecare cautare fuzzy de joc,
peste toate jocurile urmarite) pe acelasi set de perechi, native vs fallback TS.

Masuratoare reprezentativa (200.000 iteratii x 8 perechi):

| Implementare | Apeluri/s | Note |
| --- | --- | --- |
| Rust native | ~2,38M | addonul NAPI |
| TS fallback | ~1,26M | `levenshteinFallback` |
| Speedup | ~1.9x | paritate native==TS: OK |

### Per zona: TS vs Rust (regula 14 demonstrata, nu doar respectata tehnic)

`npm run benchmark:cpu` masoara acum si fiecare functie nativa fata de fallback-ul TS
echivalent, pe acelasi input (`runAreaBenchmarks`), cu verificare de paritate a rezultatului.
Masuratoare reprezentativa (100.000 iteratii; cifrele difera intre masini, conteaza raportul):

| Zona (functie) | TS (apeluri/s) | Rust (apeluri/s) | Rust vs TS | Paritate |
| --- | --- | --- | --- | --- |
| `levenshtein` | ~1,27M | ~2,40M | **~1.9x** (Rust mai rapid) | OK |
| `dealHash` (hashing) | ~1,11M | ~1,70M | **~1.5x** (Rust mai rapid) | OK |
| `findGameKeys` (fuzzy-match) | ~107k | ~76k | ~0.7x (Rust mai lent) | OK |
| `buildAutocompleteChoices` | ~1,15M | ~99k | ~0.09x (Rust mai lent) | OK |
| `dealPassesFilters` | ~37M | ~3,1M | ~0.08x (Rust mai lent) | OK |
| `rankListingCandidates` (listing-rank) | ~24k | ~30k | **~1.25x** (Rust mai rapid) | OK |

Interpretare onesta: Rust castiga clar doar acolo unde calculul e dominant si argumentele sunt
ieftine de trecut peste granita JS<->Rust — `levenshtein` (string-uri) si `dealHash` (SHA-256 pe string-uri;
~1.5x si dupa trecerea de la SHA-1 la SHA-256, cu paritate native==TS).
Pentru `findGameKeys` si `buildAutocompleteChoices`, fiecare apel trece un **array de candidati**
peste granita NAPI (marshaling), iar pentru `dealPassesFilters` calculul e trivial; in aceste
cazuri overhead-ul apelului nativ depaseste castigul, deci Rust e mai lent decat TS in microbenchmark.

**Decizie:**

- `levenshtein` si hashing-ul de dedupe (`dealHash` / `stableUpdateId`) **raman in Rust** — castig
  masurat (~1.5–1.9x) + paritate; sunt si cele cu adevarat hot (fuzzy peste toate jocurile, hash la
  fiecare update/reducere).
- `rankListingCandidates` (ordonarea ancorelor unei pagini de listing) **trece in Rust** (~1.25x vs
  fallback-ul TS, paritate verificata). Spre deosebire de `findGameKeys`/`buildAutocompleteChoices`,
  aici marshaling-ul array-ului se amortizeaza: scanarea de data (byte-level) + sortarea se fac complet
  nativ intr-un **singur** apel NAPI. Bonus algoritmic: codul vechi recalcula scorul + data in
  comparatorul de sort (O(n log n) apeluri native pe ancora); acum se calculeaza o singura data per
  ancora (O(n)) — castigul real fata de productia veche e mult peste 1.25x.
- `findGameKeys`, `buildAutocompleteChoices`, `dealPassesFilters` sunt acum **TS-primary**: wrapper-ele
  publice din `native/fuzzy.ts` apeleaza direct implementarea TypeScript (masurat mai rapida — Rust
  pierde pe marshaling-ul NAPI al array-urilor de candidati / calcul trivial), iar rezultatul e identic
  (paritate verificata). Functiile native raman expuse prin `getNativeFuzzy()` doar pentru benchmark si
  testele de paritate, dar nu mai sunt pe calea de productie pentru aceste trei. Astfel regula 14 e
  respectata in ambele sensuri: limbajul mai rapid pentru fiecare zona, demonstrat cu masuratori.

Fallback-ul TS exista pentru robustete (cand addonul nu poate fi incarcat), nu ca implementare
principala — cu exceptia notata mai sus, unde ar fi chiar mai eficient.

### Guard automat in CI (deciziile de mai sus, impuse)

Pentru ca deciziile „ramane in Rust pentru ca e mai rapid" sa nu se erodeze tacut, exista un guard
automat care leaga acest document de CI: `npm run benchmark:guard` (`scripts/benchmarkGuard.ts`), rulat
in `ci.yml` dupa `npm run check` (cand addonul nativ e deja construit). Guard-ul masoara, best-of-N
(`BENCH_GUARD_RUNS`, implicit 3), functiile hot-path pe care le pastram in Rust — `levenshtein`,
`dealHash` si `rankListingCandidates` — fata de fallback-ul TS, si:

- **esueaza** (`::error::`, exit 1) daca o functie hot-path e **mai lenta decat TS** sub pragul de esec
  (`BENCH_HOTPATH_FAIL_RATIO`, implicit `0.85x`) — semn ca decizia din acest document nu mai e valabila
  (regula 6/14: limbajul ramane doar daca e mai bun), deci trebuie mutata in TS sau investigata regresia;
- **esueaza** daca paritatea native != TS (rezultate divergente) — bug de corectitudine, nu de viteza;
- **avertizeaza** (`::warning::`, fara a pica) daca speedup-ul scade sub pragul asteptat documentat aici
  (`levenshtein` < `1.4x`, `dealHash` < `1.2x`, `rankListingCandidates` < `1.1x`), ca semnal ca avantajul Rust se erodeaza;
- se **sare** (CI-safe, exit 0) cand addonul nativ nu e disponibil — **cu exceptia** modului strict
  `BENCH_GUARD_REQUIRE_NATIVE=true` (setat in `ci.yml`), unde absenta addonului devine **esec**: in CI
  build-ul Rust ruleaza inainte de guard, deci un addon lipsa inseamna o problema de build, nu un skip
  acceptabil. Local (fara variabila) guard-ul ramane CI-safe si sare cand nativul lipseste.

Pragurile sunt deliberat tolerante la zgomotul masinilor de CI (best-of-N + prag de esec sub `1.0x`),
deci nu pica la variatii mici, doar la o regresie clara (Rust devine efectiv mai lent decat TS).
Logica de evaluare (`evaluateBenchmarkGuard`) este acoperita de teste deterministe in
`benchmarkGuard.test.ts` (mai rapid -> OK, sub asteptat -> avertisment, mai lent -> esec, paritate
divergenta -> esec, nativ indisponibil -> sarit).

## 2. Outbox: drenare job-by-job (I/O-bound)

`npm run benchmark:outbox` seedeaza N joburi in `notificationOutbox` (Mongo real) si
masoara o drenare completa cu `deliver` no-op (deci timpul reflecta strict costul de DB +
bucla de drenare, fara latenta Discord).

Masuratoare reprezentativa (Mongo local):

| Joburi | Total | ms/job | joburi/s |
| --- | --- | --- | --- |
| 1.000 | ~1.7s | ~1.7 | ~590 |
| 5.000 | ~7.3s | ~1.5 | ~680 |
| 10.000 | ~14s | ~1.4 | ~710 |

Costul per job e dominat de round-trip-urile sincrone catre Mongo (claim atomic
`findOneAndUpdate` + verificare `notificationOutboxSent` + `markSent` + `deleteOne`).
Scalarea este **liniara** (~1.4ms/job stabil), deci drenarea job-by-job **nu** devine
brusc bottleneck — pur si simplu dureaza proportional cu numarul de joburi.

`runOutboxPhaseBreakdown` (in acelasi script) descompune cei ~1.3ms/job de Mongo pe faze
si ii pune in context fata de o trimitere Discord tipica (masuratoare reprezentativa, Mongo
local, `deliver` mock, `OUTBOX_BENCH_SEND_MS=100`):

| Faza per job | ms/job |
| --- | --- |
| claim (`findOneAndUpdate`) | ~0.46 |
| dedupe-check (`exists`) | ~0.26 |
| markSent (`updateOne`) | ~0.36 |
| delete (`deleteOne`) | ~0.25 |
| **TOTAL Mongo** | **~1.33** |
| vs trimitere Discord tipica ~100ms | **Mongo = ~1.3% din timpul real per job** |

Asta cuantifica de ce optimizarea ramane viitoare: per job, **~98.7% din timp e trimiterea
Discord (rate-limited)**, iar Mongo e ~1.3%. Un claim in batch / `bulkWrite` ar reduce doar
faza `claim` (~0.46ms) — celelalte trei raman per-job din **corectitudine** (claim atomic +
`markSent`-inainte-de-`deleteOne` pentru crash-safety), deci plafonul realist de castig e
**sub ~1.3%** pe o cale dominata de Discord. La ~700 joburi/s pe care Mongo le sustine deja
vs ritmul mult mai mic impus de rate-limit-ul Discord, exista ~60x rezerva de Mongo peste
ce permite Discord — deci batch-claim ar mari o rezerva oricum nefolosita, cu riscul de a
rescrie claim-ul atomic multi-instanta (clasa de bug #237). Decizia pe date: **nu acum.**

**Decizie:**

- Outbox-ul **ramane in TypeScript**. Bottleneck-ul este I/O (Mongo + Discord), nu CPU;
  rescrierea in Rust nu ar aduce niciun castig (timpul se duce in round-trip-uri de retea,
  nu in calcul).
- Drenarea **job-by-job (cu lease atomic)** ramane implementarea curenta fiindca garanteaza
  exact-once la nivel de claim si e corecta intre instante. Un `bulkWrite` / claim in batch
  ar reduce numarul de round-trip-uri, dar este o optimizare **viitoare** cu praguri de
  declansare concrete documentate in `ROADMAP.md` („Outbox: claim in batch"): pe scurt,
  `bot_outbox_queue_depth` > 500 sustinut ≥ 2h sau `bot_outbox_oldest_job_age_seconds` > 900
  sustinut ≥ 30 min **in timp ce worker-ul chiar dreneaza** (nu pe pauza). Alerta
  `OutboxBatchDrainRecommended` semnaleaza automat aceasta conditie. La ~700 joburi/s per
  drenare, cu worker pe interval scurt si rate-limit Discord ca factor dominant real, volumul
  tipic este acoperit confortabil sub aceste praguri.

## 3. Scalare notificari

`npm run benchmark` (vezi `scripts/notificationBenchmark.ts`) arata ca faza de fetch este
O(surse) (partajata intre guild-uri), iar dispatch-ul este O(guild-uri) cu un singur mesaj
batch (pana la 10 embed-uri) per guild — deci costul creste cu numarul de servere abonate,
nu cu numarul de jocuri.
