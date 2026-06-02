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

**Decizie:** hot-path-urile CPU (fuzzy matching, hashing dedupe) **raman in Rust** — exista
un castig masurat (~1.9x) si paritate de rezultat cu fallback-ul TS. Fallback-ul TS exista
pentru robustete (cand addonul nu poate fi incarcat), nu ca implementare principala.

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
  ar reduce numarul de round-trip-uri, dar este o optimizare **viitoare**, justificata doar
  daca `bot_outbox_queue_depth` / `bot_outbox_oldest_job_age_seconds` raman sustinut mari la
  volum real (vezi `OPERATIONS.md`). La ~700 joburi/s per drenare, cu worker pe interval
  scurt si rate-limit Discord ca factor dominant real, volumul tipic este acoperit confortabil.

## 3. Scalare notificari

`npm run benchmark` (vezi `scripts/notificationBenchmark.ts`) arata ca faza de fetch este
O(surse) (partajata intre guild-uri), iar dispatch-ul este O(guild-uri) cu un singur mesaj
batch (pana la 10 embed-uri) per guild — deci costul creste cu numarul de servere abonate,
nu cu numarul de jocuri.
