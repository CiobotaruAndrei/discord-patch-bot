# Roadmap (optimizari amanate)

Optimizari masurate si **amanate intentionat** fiindca volumul actual nu le justifica.
Fiecare are praguri concrete care, daca sunt atinse sustinut in productie, declanseaza
implementarea. Pana atunci, implementarea curenta este corecta si suficienta (vezi
`BENCHMARKS.md` pentru masuratori).

## Outbox: claim in batch (`bulkWrite`) in loc de job-by-job

**Starea curenta.** Worker-ul dreneaza outbox-ul **job-by-job**: pentru fiecare job face un
claim atomic (`findOneAndUpdate` cu `lockedUntil` + `$inc deliveries`), verifica
`notificationOutboxSent`, trimite, apoi `markSent` + `deleteOne`. Benchmark-ul
(`npm run benchmark:outbox`) arata scalare **liniara** la ~1.4ms/job (~700 joburi/s), iar
factorul dominant real este rate-limit-ul Discord, nu Mongo. Claim-ul per-job garanteaza
exact-once la nivel de revendicare si este corect intre instante (test multi-instance pe
Mongo real).

**Ce s-ar schimba.** Inlocuirea buclei per-job cu un **claim in batch**: selectarea a N
joburi scadente si revendicarea lor cu un singur round-trip (`updateMany` cu un token de
lease + `lockedUntil`), livrarea lor, apoi `bulkWrite` pentru `delete`/reprogramare. Reduce
numarul de round-trip-uri Mongo de la O(N) la O(N / dimensiune_batch).

**Praguri de declansare (toate masurate pe `/metrics`, in operare normala — NU pe pauza).**
„Pe pauza" se exclude verificand ca `bot_outbox_last_drain_age_seconds` ramane mic (worker-ul
chiar dreneaza, dar nu tine pasul); daca e mare, problema e pauza/lock-ul, nu lipsa batch-ului
(vezi `OPERATIONS.md`).

Implementeaza batch claim daca **oricare** dintre conditii este sustinuta:

- `bot_outbox_queue_depth` > **500** timp de **≥ 2h** continuu (backlog cronic, nu un incident
  tranzitoriu); **sau**
- `bot_outbox_oldest_job_age_seconds` > **900** (15 min) timp de **≥ 30 min** continuu, in timp
  ce `bot_outbox_last_drain_age_seconds` ramane mic (drenarea ruleaza dar nu prinde din urma).

Sub aceste praguri, drenarea job-by-job ramane alegerea corecta (mai simpla, exact-once
evident). Alerta `OutboxBatchDrainRecommended` din `monitoring/prometheus-alerts.yml`
semnaleaza automat conditia de backlog cronic si trimite la acest document.

**Constrangeri pe care implementarea de batch trebuie sa le pastreze.**

- exact-once la nivel de claim intre instante (niciun job revendicat de doi workeri) — token de
  lease per batch + `lockedUntil`;
- deduplicarea prin `notificationOutboxSent` + `dedupeKey` (index unic sparse) ramane;
- recovery-verify per-job ramane (un batch nu trebuie sa anuleze verificarea pe istoric pentru
  joburile re-revendicate dupa crash);
- esecul unui job din batch nu trebuie sa blocheze restul (per-job `try/catch`, ca acum).

**Validare la implementare.** `npm run benchmark:outbox` (scalare + livrare completa la N mare),
testul multi-instance pe Mongo real (zero dublu-claim) si testele de crash-recovery existente
trebuie sa ramana verzi.

## CPU hot-paths in Rust

Deja evaluat si **decis**: hot-path-urile CPU cu castig masurat (`levenshtein` ~1.9x,
`dealHash` ~1.5x fata de fallback-ul TS, cu paritate de rezultat) raman in Rust. Outbox-ul
ramane in TypeScript fiindca e I/O-bound. Vezi `BENCHMARKS.md`.

## TS-primary pentru functiile native fara castig (IMPLEMENTAT)

Benchmark-ul per-zona (`runAreaBenchmarks`, `BENCHMARKS.md`) a aratat ca `findGameKeys`,
`buildAutocompleteChoices` si `dealPassesFilters` sunt mai lente in Rust decat in TS (overhead de
marshaling NAPI al array-urilor de candidati / calcul trivial). Aceste trei functii au fost comutate
pe **TS-primary**: wrapper-ele publice din `native/fuzzy.ts` apeleaza direct implementarea TypeScript,
cu rezultat identic (paritate verificata). Variantele native raman expuse prin `getNativeFuzzy()` doar
pentru benchmark/paritate. Daca vreodata devin hot-path si profilul Rust devine favorabil, pot fi
re-comutate pe nativ (functia nativa exista inca).
