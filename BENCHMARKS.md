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
- `findGameKeys`, `buildAutocompleteChoices`, `dealPassesFilters` **raman in Rust ca sursa unica**
  (cu paritate verificata), desi microbenchmark-ul arata ca nu aduc castig: nu sunt hot-path-uri
  (autocomplete e per-tasta dar debounce-uit + max 25 elemente; `findGameKeys` per comanda;
  `dealPassesFilters` ruleaza pe ~zeci de oferte per guild intr-un ciclu cron I/O-bound), iar costul
  absolut e de ordinul microsecundelor — neglijabil fata de I/O-ul ciclului. Daca vreodata devin hot,
  varianta TS-primary este masurat mai rapida si ar fi alegerea corecta (vezi `ROADMAP.md`).

Fallback-ul TS exista pentru robustete (cand addonul nu poate fi incarcat), nu ca implementare
principala — cu exceptia notata mai sus, unde ar fi chiar mai eficient.

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
