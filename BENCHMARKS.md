# Benchmarks & decizii de performanta

Documentul aduna masuratori reproductibile pentru zonele sensibile la performanta si
deciziile de design care decurg din ele (in special: ce sta in Rust si ce sta in
TypeScript, conform regulii „nu se scoate o bucata de limbaj decat daca inlocuitorul
face botul mai bun si mai eficient").

Rerulare:

```bash
cd src
npm run benchmark:cpu        # native vs TS pentru hot-path-urile CPU
npm run benchmark:inspection # motorul de inspectie: blocare event loop + concurenta
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

### Per zona: TS vs Rust (regula limbajului demonstrata cu date, nu doar respectata tehnic)

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
| `extractAndRankListingCandidates` (listing-batch) | ~16k | ~37k | **~2.3x** (Rust mai rapid) | OK |
| `selectLatestSteamPatchNote` (steam-patch) | ~270k | ~21k | ~0.08x (Rust mai lent) | OK |
| `chooseBestSteamMatch` (steam-match) | ~33k | ~83k | **~2.5x** (Rust mai rapid) | OK |
| `dedupeAndRankDeals` (deals-dedupe, 200 oferte) | ~40k | ~10k | ~0.26x (Rust mai lent) | OK |

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
- `extractAndRankListingCandidates` (pipeline-ul complet de listing, Prioritate 1) **trece in Rust**
  (~2.3x vs fallback-ul TS, paritate verificata). Consolideaza intr-un **singur** apel NAPI intreg
  hot-path-ul CPU care inainte facea multe apeluri native mici per ancora: `cleanText` per ancora +
  `scoreListingCandidate` per ancora + un apel separat `rankListingCandidates`. Acum TypeScript
  (`listingUpdates.ts`) extrage cu Cheerio doar perechile ancora `{ href, rawText }` (href deja
  absolutizat + trecut prin regex, operatii pur-JS non-native) si trimite tot lotul o singura data;
  Rust curata textul, filtreaza scorul 0 cand exista keywords, deduplica dupa href, calculeaza scorul
  + scorul de data, ordoneaza si intoarce doar cei mai buni `max_results` (compact `{ href, text }`).
  Fata de productia veche, care traversa granita NAPI de `2N+1` ori per pagina, castigul real e mult
  peste 2.3x. Parsarea HTML ramane intentionat in Cheerio (parser lenient, referinta de paritate);
  a muta si parsarea DOM in Rust ar adauga un parser HTML cu risc de divergenta pe HTML invalid, fara
  castig CPU proportional.
- `chooseBestSteamMatch` (alegerea celui mai bun rezultat Steam pentru un query, PDF Prioritate 3
  „conditionat") **trece in Rust** (~2.5x vs fallback-ul TS, paritate verificata). Spre deosebire de
  `selectLatestSteamPatchNote`, aici calculul **nu** e trivial: normalizarea + `levenshtein` pe nume
  lungi de jocuri (editii/DLC-uri) e O(n·m) per candidat, deci Rust-ul isi amortizeaza marshaling-ul
  array-ului si castiga stabil. Codul vechi apela `levenshtein` nativ **per candidat** (N traversari
  NAPI); acum filtrarea games-only + scoringul complet (bonus egal/prefix/includere, penalizare
  DLC/demo/music) se fac intr-un **singur** apel batch care intoarce doar indexul castigatorului
  (`steam/index.ts` reconstruieste `items[index]`). Pragul de warn e mai ridicat (`1.3x`) fiindca
  avantajul masurat e clar.
- `findGameKeys`, `buildAutocompleteChoices`, `dealPassesFilters`, `selectLatestSteamPatchNote`,
  `dedupeAndRankDeals` sunt acum
  **TS-primary**: wrapper-ele publice din `native/fuzzy.ts` apeleaza direct implementarea TypeScript
  (masurat mai rapida — Rust pierde pe marshaling-ul NAPI al array-urilor de candidati / calcul trivial),
  iar rezultatul e identic (paritate verificata). Functiile native raman expuse prin `getNativeFuzzy()`
  doar pentru benchmark si testele de paritate, dar nu mai sunt pe calea de productie. Astfel regula
  limbajului e respectata in ambele sensuri: limbajul mai rapid pentru fiecare zona, demonstrat cu masuratori.
- `dedupeAndRankDeals` (deduplicare + ordonare oferte, PDF Prioritate 4 „conditionat") **ramane TS**.
  Benchmark la 200 de oferte (dimensiune realista: Steam + Epic specials): Rust **~0.26x** vs fallback-ul
  TS, paritate OK. Calculul (normalize + dedup Map + sort) e trivial, iar marshaling-ul a 200 de obiecte
  string domina — exact conditia din PDF („se pastreaza varianta Rust numai daca avantajul ramane stabil
  la dimensiunile reale, nu doar la loturi artificiale foarte mari"). Castigul real vine tot din
  consolidare in TS: `dealHelpers.ts` nu mai apeleaza `normalizeTitleForDedupe` nativ per oferta
  (N traversari NAPI), ci o singura functie TS `dedupeAndRankDealsIndex` (0 traversari) care intoarce
  indecsii. Functia Rust `dedupe_and_rank_deals` + paritatea raman doar pentru benchmark/inregistrare.
- `selectLatestSteamPatchNote` (alegerea celui mai nou patch note dintr-un feed Steam de pana la 50 de
  stiri) merita o nota aparte: PDF-ul „Patru bucati concrete de trecut in Rust" il propunea drept
  Prioritate 2 (a colapsa multele apeluri native per stire — `isGoodSteamArticleUrl` +
  `classifyPatchNote` — intr-un singur apel batch). Masuratoarea infirma ipoteza Rust: batch-ul Rust
  transfera 50 de obiecte cu campuri string peste granita NAPI, iar calculul (contains pe string-uri) e
  trivial, deci pierde masiv (~0.08x) fata de o singura trecere pur-TS. Castigul real fata de **productia
  veche** vine totusi din consolidare: `steamUpdates.ts` nu mai apeleaza `isGoodSteamArticleUrl` +
  `classifyPatchNote` per stire (~100 apeluri native per feed), ci o singura functie TS
  (`selectLatestSteamPatchNoteIndex`) care face totul intr-o singura trecere, fara nicio traversare NAPI.
  Deci Prioritatea 2 se livreaza ca **batch TS**, nu Rust — exact ce cere metodologia PDF-ului: candidatul
  intra in productie doar daca benchmark-ul arata avantaj, iar aici avantajul e al TS-ului.

Fallback-ul TS exista pentru robustete (cand addonul nu poate fi incarcat), nu ca implementare
principala — cu exceptia notata mai sus, unde ar fi chiar mai eficient.

### Motor batch asincron: `inspectUntrustedContent` (inspectia pasiva de continut neincredibil)

Toate zonele de mai sus sunt apeluri **sincrone**, deci metrica relevanta e apeluri/s. Inspectia
pasiva a atasamentelor este alt tip de workload: un singur apel poate traversa o arhiva intreaga
(ZIP/TAR/GZIP recursiv, parser structural CFB/OLE, de-ofuscare PDF), pana la bugetul de 8 MiB
decomprimati si 64 de intrari. In TypeScript asta rula **sincron pe event loop**, deci un singur
atasament ostil bloca tot botul (heartbeat-ul Discord, cron-ul, drenarea outbox) cat dura analiza.

Motorul e acum un **singur apel batch asincron** — `inspect_untrusted_content(input) -> InspectionReport`
in `src/native/core/src/inspection.rs`, expus prin N-API `AsyncTask` (`src/native/src/lib.rs`), deci
intreaga traversare ruleaza pe thread pool-ul libuv, nu pe event loop. TypeScript pastreaza tot ce e
I/O si decizie: descarcarea fisierului, integrarea Discord, apelul catre motorul extern de reputatie,
decizia de alerta/stergere, logarea si persistenta. Rust primeste doar `bytes + filename + mime + mode +
limite` si intoarce `status / indicators / reason / entriesInspected / expandedBytes / elapsedMs`.

`npm run benchmark:inspection` masoara pe o arhiva ZIP realista (~1,4 MB, 24 de intrari deflate cu
continut incompresibil, deci fara scurtcircuitul de raport de compresie):

| Metrica | TS sincron | Rust `AsyncTask` | Raport |
| --- | --- | --- | --- |
| Blocare main thread / inspectie | ~2,05 ms | ~0,18 ms (doar marshaling) | **~11x mai putina blocare** |
| Latenta secventiala / inspectie | ~2,05 ms | ~2,02 ms | ~1,0x (egalitate) |
| 8 atasamente deodata | ~16,4 ms (secvential, blocant) | ~4,1 ms (paralel pe thread pool) | **~4,0x** |
| Paritate raport native==TS | — | — | OK (16 fixtures) |

Interpretare onesta: **castigul nu e viteza bruta de calcul** — pe o singura inspectie Rust e la egalitate
cu TypeScript (zlib e deja nativ in Node, iar restul e scanare de bytes, la fel de ieftina in ambele).
Castigul e ca munca **iese de pe event loop** (~11x mai putina blocare per inspectie) si ca inspectiile
concurente chiar ruleaza in paralel (~4x la 8 atasamente simultane, plafonat de dimensiunea thread pool-ului
libuv). De aceea guard-ul masoara pentru aceasta zona **reducerea blocarii**, nu latenta secventiala:
raportarea unui „speedup" de ~1.0x ar fi corecta ca numar si complet inselatoare ca decizie.

**Decizie:** motorul de inspectie **trece in Rust ca task asincron**, native-first cu fallback TS complet
(`inspectUntrustedContentFallback`) pentru cand addonul lipseste. Modul (`archive` / `document` / `auto`)
ramane decis de TypeScript (`classifyResource`), fiindca un `.docx` este fizic un ZIP: daca Rust ar
autodetecta formatul, un document ar fi tratat brusc ca arhiva si verdictele ar diverge tacut fata de
comportamentul actual. Limitele (adancime, intrari, bytes decomprimati, raport de compresie, timeout) sunt
parametri de apel, identici in ambele implementari, verificati prin teste de paritate.

Ce **nu** s-a mutat, deliberat: descarcarea si HTTP-ul, apelul catre motorul extern de reputatie, deciziile
de moderare si persistenta — sunt I/O si politica, nu calcul (vezi sectiunea 4).

**PDF si OOXML** sunt parcurse structural, nu doar prin fereastra de scanare. Pentru PDF, motorul
localizeaza obiectele `stream`/`endstream`, decomprima fluxurile `/FlateDecode` (bounded de aceleasi
limite de bytes decomprimati si timp) si scaneaza continutul DECODAT — asa se prinde un `/JavaScript`
sau un `/EmbeddedFile` ascuns intr-un flux comprimat, complet invizibil pentru scanarea latin1 a
bytes-ului brut. Pentru OOXML, fisierele `.rels` sunt parsate ca **graf de relatii** (`Type`, `Target`,
`TargetMode`), nu doar cautate dupa siruri: relatiile `attachedTemplate`/`frame` cu `TargetMode="External"`
(vectorul clasic de sablon Word incarcat de la distanta) primesc indicator dedicat, iar `oleObject`,
`package` si `vbaProject` sunt clasificate dupa tipul relatiei, nu dupa numele intrarii. Parsarea
grafului elimina si un fals pozitiv real: pana acum ORICE `.rels` era marcat „referinta externa" fiindca
`xmlns="http://schemas.openxmlformats.org/..."` contine `http://`.

**RAR si 7z** sunt acum parcurse structural **la nivel de header**, in acelasi task Rust: RAR4 (blocuri
`FILE_HEAD`) si RAR5 (headere cu `vint`) sunt enumerate ca nume de intrari, iar 7z isi expune tipul
headerului urmator (`kHeader` simplu vs `kEncodedHeader` codificat/criptat). Numele obtinute trec prin
aceeasi clasificare ca intrarile ZIP/TAR, deci un `installer.exe` sau un `macros/auto.vbs` dintr-un RAR
produce indicator **fara sa fie decomprimat nimic**. Continutul comprimat tot nu are decodor pasiv local,
deci verdictul ramane `uncertain` (escaladat la motorul extern, nu declarat curat) — dar motivul e acum
precis: arhiva criptata, header criptat, structura trunchiata sau „inspectata doar la nivel de header (N
intrari)". Bugetul de intrari se aplica si scanarii de headere, iar intrarile de tip director nu produc
indicatori de fisier.

### Guard automat in CI (deciziile de mai sus, impuse)

Pentru ca deciziile „ramane in Rust pentru ca e mai rapid" sa nu se erodeze tacut, exista un guard
automat care leaga acest document de CI: `npm run benchmark:guard` (`scripts/benchmarkGuard.ts`), rulat
in `ci.yml` dupa `npm run check` (cand addonul nativ e deja construit). Guard-ul masoara, best-of-N
(`BENCH_GUARD_RUNS`, implicit 3), functiile hot-path pe care le pastram in Rust — `levenshtein`,
`dealHash`, `stableUpdateId`, `rankListingCandidates`, `extractAndRankListingCandidates`,
`chooseBestSteamMatch` si `inspectUntrustedContent` — fata de fallback-ul TS, si:

- **esueaza** (`::error::`, exit 1) daca o functie hot-path e **mai lenta decat TS** sub pragul de esec
  (`BENCH_HOTPATH_FAIL_RATIO`, implicit `0.85x`) — semn ca decizia din acest document nu mai e valabila
  (regula limbajului: ramane doar daca e mai bun/eficient), deci trebuie mutata in TS sau investigata regresia;
- **esueaza** daca paritatea native != TS (rezultate divergente) — bug de corectitudine, nu de viteza;
- **avertizeaza** (`::warning::`, fara a pica) daca speedup-ul scade sub pragul asteptat documentat aici
  (`levenshtein` < `1.4x`, `dealHash` < `1.2x`, `stableUpdateId` < `1.2x`, `rankListingCandidates` < `1.1x`, `extractAndRankListingCandidates` < `1.1x`, `chooseBestSteamMatch` < `1.3x`, `inspectUntrustedContent` < `4x`), ca semnal ca avantajul Rust se erodeaza;
- masoara pentru `inspectUntrustedContent` **alta metrica**, declarata explicit in raport
  (`metric`): reducerea blocarii event loop-ului (TS sincron / Rust `AsyncTask`), nu latenta
  secventiala — vezi sectiunea despre motorul batch asincron pentru de ce latenta secventiala ar fi
  o metrica inselatoare aici;
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

## 4. Politica limbaje: cand folosim Rust si cand TypeScript

Regula practica derivata din masuratorile de mai sus (si aliniata cu regulile 6 si 20 din
`docs/Reguli de respectat.md`):

- **Rust merita doar pentru logica pura CPU-bound**: fuzzy matching pe volume mari,
  normalizare masiva de text, parsare/scoring de preturi sau dedupe pe liste mari. Chiar si
  acolo, decizia se ia pe benchmark real (`npm run benchmark:cpu`), nu pe intuitie —
  sectiunea 1 arata ca `buildAutocompleteChoices` a iesit ~0.09x in Rust (boundary cost NAPI
  peste un workload mic), deci a ramas TS-primary.
- **Rust merita si pentru munca lunga care blocheaza event loop-ul**, chiar la egalitate de viteza
  bruta: daca un singur apel poate rula milisecunde bune pe input controlat de atacator (inspectia
  pasiva a atasamentelor), mutarea lui intr-un `AsyncTask` scoate blocarea de pe event loop si permite
  paralelism real. Metrica de decizie acolo e blocarea main thread-ului si throughput-ul concurent, nu
  latenta unui apel izolat (vezi sectiunea despre motorul batch asincron).
- **Nu mutam I/O in Rust**: orchestrarea Discord, Mongo, HTTP, cron si fluxul YouTube sunt
  dominate de latenta de retea/DB (sectiunea 2: outbox-ul e I/O-bound, rate-limit Discord e
  factorul real), unde Rust nu aduce nimic si complica build-ul si review-ul. Pentru acestea
  TypeScript ramane alegerea corecta.
- **Orice mutare noua in Rust cere**: benchmark inainte/dupa in acest fisier, prag de
  regresie in `benchmarkGuard` (gardul pica daca avantajul Rust dispare) si fallback TS
  echivalent testat pentru paritate.

**Confirmare review "Backlog Refactor" #10 (2026-07-04).** Recomandarea review-ului — "nu muta
HTTP/Mongo/Discord in Rust; investigheaza doar hot-path-uri CPU-bound cu benchmark:
dedupe/ranking oferte, normalizare string, scoring fuzzy suplimentar, eventual packing de
loturi mari" — coincide cu politica de mai sus, iar candidatii numiti sunt deja masurati si
decisi cu date in sectiunea 1: dedupe-ul de oferte (`dealHash`) si ranking-ul
(`rankListingCandidates`) ruleaza in crate-ul Rust (cu praguri in `benchmarkGuard`),
normalizarea de string (`normalize_title_for_dedupe`/`clean_text`) si fuzzy matching-ul
(`find_game_keys`/`levenshtein`) la fel, iar scoring-ul suplimentar de autocomplete
(`buildAutocompleteChoices`) a iesit ~0.09x in Rust si a ramas intentionat TS-primary.
Singurul candidat numit si nemasurat — "packing de loturi mari" (gruparea embed-urilor in
mesaje batch si a joburilor de outbox) — nu e un hot-path CPU: gruparea e slicing liniar pe
liste mici (max 10 embed-uri/mesaj), iar costul real e I/O-ul Discord (sectiunea 2, ~98.7%
Discord-bound), deci ramane TypeScript; devine candidat de benchmark doar daca profilarea
arata altceva la volume mult mai mari. Concluzie: niciun port nou in Rust fara un benchmark
care arata castig real — exact regula existenta, confirmata.
