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

## Sharding gateway Discord (la scara mare)

**Limita reala de scalare a botului nu e Node, Mongo sau limbajul — e Discord.** Doua plafoane:

- **Gateway:** Discord **impune sharding la 2.500 de guild-uri** (refuza o conexiune ne-shardata
  peste prag). Pana atunci, o singura conexiune e suficienta.
- **REST / trimitere:** rate-limit global (~50 req/s) + per-route, **per token**. Botul paceuieste
  deja prin token-bucket-ul de send + outbox; gateway sharding-ul **nu** mareste limita REST globala
  (ramane per-token), deci sub 2.500 guild-uri rate-limit-ul Discord — nu lipsa shardingului — e
  factorul dominant (vezi `BENCHMARKS.md` sectiunea 2: outbox-ul e ~98.7% Discord-bound).

**Starea curenta.** Clientul e o singura conexiune: `new Client({ intents: [GatewayIntentBits.Guilds] })`
(`appRuntime.ts`), fara configurare de sharding (1 shard). **Fundatia pentru rulare distribuita exista
deja:** munca periodica e coordonata prin lock-uri DB — `cron_main` (ciclul de notificari) si
`outbox_drain` (drenarea outbox) — deci **un singur runner** executa munca la un moment dat, corect
intre instante (test multi-instance pe Mongo real). Ce **nu** e pus la punct e partea de gateway:
rularea naiva a mai multor copii cu **acelasi token fara shard ID-uri** ar fi respinsa de Discord
(conexiuni duplicate) — scalarea orizontala reala cere sharding propriu (shard ID-uri), nu copii.

**Ce s-ar schimba.** Configurare de sharding gateway, fara a atinge logica de business:

- la scara moderata: `shards: 'auto'` pe acelasi proces (internal sharding) — la 1 shard e identic cu
  acum, deci e si o pregatire low-risk pentru pragul de 2.500;
- la scara mare: `ShardingManager` (N procese-shard, fiecare cu shard ID-uri distincte).

Coordonarea cron/outbox **ramane pe lock-urile DB** — sursa unica de adevar pentru „cine ruleaza munca",
deci nu trebuie presupus „un singur proces". De ajustat la sharding: agregarea metricilor/health
**per-shard** (guild count, starea fiecarui shard).

**De ce NU multiple token-uri.** Trimiterile de la identitati de bot diferite ar confuza userii si ridica
probleme de ToS; gateway sharding pe **acelasi** token e calea suportata. Multiple token-uri nu e o
optimizare, e o regresie de UX/conformitate.

**Praguri de declansare.**

- Te apropii de **2.500 de guild-uri** → gateway sharding devine **obligatoriu** (Discord refuza altfel).
  Semnal: numarul de guild-uri (din `/health`).
- Throttling sustinut la **trimiterea** Discord → `bot_outbox_queue_depth` + `bot_outbox_oldest_job_age_seconds`
  cresc continuu **in timp ce worker-ul chiar dreneaza** (`bot_outbox_last_drain_age_seconds` mic). Acelasi
  semnal e descris in `OPERATIONS.md` la „Rate-limit Discord". (Nota: `bot_rate_limit_hits` masoara `429`-uri
  de la fetch-urile **upstream** Steam/Epic prin `httpReq`, **nu** trimiterile Discord — alea trec prin
  discord.js + token-bucket-ul de send, deci semnalul corect pentru limita de trimitere e backlog-ul de outbox.)

**Constrangeri de pastrat la implementare.**

- lock-urile DB (`cron_main`, `outbox_drain`) raman singura coordonare a muncii periodice — corecte la
  N shards/procese;
- exact-once la notificari ramane garantat de outbox + `notificationOutboxSent` (deja multi-instance-safe);
- un shard care cade nu trebuie sa opreasca restul (proces izolat + restart per shard).

**De ce e amanat.** Botul e (cu mare probabilitate) mult sub 2.500 de guild-uri, iar debitul de trimitere
e mult sub limita REST globala. Sharding-ul acum = complexitate de multi-proces + coordonare, pentru zero
beneficiu curent — single-shard + lock-uri DB e corect si suficient pana la prag.

## Migrarea registrelor la factory-uri per handler/sursa (datoria arhitecturala ramasa)

**Starea curenta.** Compunerea trece prin doua registre cu installers `export =` care muteaza un
context comun. Contractele de iesire sunt inchise si tipate (`CommandRegistryContext`,
`SourceRegistryApi`, `CommandRuntimeContext`), iar granita de instalare nu mai foloseste `as never`
/ `as unknown as`: `commandRegistry` instaleaza printr-un singur `as` de narrowing
(`context as T & CommandInstallerTarget`, permis de regula 2), iar `sourceRegistry` citeste
exporturile prin `requireSourceValue` pe un context proaspat per registry. Zero `as never`
/ `as unknown as` e impus automat de `check:weakening` (gate AST) plus gardul
`registryClosedContracts.test.ts`. Problema ramasa nu mai e `as never`, ci boundary-ul de instalare
dinamic in sine (contextul progresiv mutat de installers). Tipizarea directa a compunerii a fost
incercata si respinsa cu proba: supratipul comun al dependintelor structurale declarate independent
per handler colapseaza in `never`/`any` (vezi FUNCTION_MAP_CLEAN, sectiunea commandRegistry), deci
eliminarea completa a boundary-ului cere DI per handler/sursa, nu tiparea registrului progresiv.

**Pasii de migrare (incremental, cate un PR per grup):**

1. fiecare modul expune deja `createX(deps)` cu dependinte inguste — handler-ele noi se scriu DOAR asa;
2. `commandRuntimeContext` se sparge in furnizori mici (bindings Discord, exporturi Mongo, surse),
   iar compozitia apeleaza factory-urile explicit cu `Pick<>`-uri din furnizori, in ordinea dependentelor;
3. installer-ele `attachX` raman doar ca adaptoare de compatibilitate pana cand toti consumatorii
   folosesc factory-urile, apoi se sterg impreuna cu registrul si cu boundary-ul de instalare dinamic
   (ultimul `as` de narrowing al compozitiei);
4. `check:weakening` plus gardurile AST din `registryClosedContracts.test.ts` impun deja zero `as never`
   / `as unknown as` si se mentin la fiecare pas; ultima migrare elimina si `as`-ul de narrowing ramas.

**Boundary-urile `& Record<string, unknown>` ale adaptoarelor (urmatorul pas catre nota 10).** Acelasi
tipar de installer `attachX` largeste contextul de instalare la `Deps & Record<string, unknown>` ca sa
accepte cheile adaugate progresiv: `NotificationsContext` (`notifications/index.ts`), `HttpClientContext`
(`infra/http/client.ts`). **Pasi siguri facuti (review manual R11 #4 + #5):** (a) `sourceRegistry` —
`SourceRuntimeContext` a fost stramtat din `Partial<SourceRegistryApi> & runtime & Record<string, unknown>`
la exact `Partial<SourceRegistryApi> & runtime` (installer-ele de surse nu adaugau chei in afara API-ului,
deci indexul larg era inutil); (b) `commandRegistry` — campurile de iesire tipate generic cu
`RegistryFunction = (...args: unknown[]) => MaybePromise<unknown>` au primit semnaturi precise
(`cleanCache: () => void`, `buildSlashCommandDefinitions: () => unknown[]`, `getFindGameCacheSize: () => number`
etc.), iar tipul generic a fost eliminat. **Ce ramane** (tipizarea **uniforma** a boundary-ului de instalare
in sine — `installers: readonly unknown[]` + apelul dinamic) e in continuare blocat: tiparea installer-elor
ca un singur `CommandModuleInstaller[]` colapseaza la tsc (varianta pe campuri-functie ca `setDealsCache`,
proba reconfirmata), deci eliminarea completa cere migrarea la factory-uri `createX(deps)` de mai sus.
`Record<string, unknown>` ramas (`NotificationsContext`, `HttpClientContext`) e un index type-safe (nu `any`,
permis de regula 2), nu un bug; dispare odata cu aceeasi migrare. Gardat de `registryClosedContracts.test.ts`
(fara `Record<string, unknown>` pe `SourceRuntimeContext`, fara `RegistryFunction` generic in `commandRegistry`).

**Consistenta env in stratul progresiv (follow-up).** Boot-ul scheduler-ului si `notifications/index.ts`
citesc deja toata configuratia outbox (`NOTIFICATION_OUTBOX_ENABLED` + `DRAIN_LIMIT` / `MAX_AGE_MS` /
`RECOVERY_VERIFY` / `RECOVERY_STRICT` / `RECOVERY_HISTORY_LIMIT`) din env-ul centralizat (`RuntimeEnv`,
parsat o singura data in `shared/env.ts` cu `parseEnvNumber`/`parseBooleanEnv`): `createNotificationRuntime`
le ia din `deps.env`, deci sunt injectabile in teste, fara citiri `process.env` la nivel de modul. La fel,
boot-ul citeste acum `MIGRATIONS_CONTINUE_ON_ERROR` (din `appRuntime`), iar `client.ts` citeste
`ALLOW_DEFAULT_PROXIES`, ambele din `RuntimeEnv` injectat in loc de `process.env` direct.
**Citirile ramase** sunt: (1) ~~`outboxAdminHandler.ts`~~ **REZOLVAT (review manual R11 #3)**: handler-ul
foloseste deja acelasi parser ca `RuntimeEnv`, deci parsarea era consistenta; problema ramasa era doar
**sursa** (`process.env` in loc de `env` tipat injectat). Acum citeste `NOTIFICATION_OUTBOX_ENABLED` /
`NOTIFICATION_OUTBOX_RECOVERY_VERIFY` / `NOTIFICATION_OUTBOX_RECOVERY_STRICT` din `target.env` (tipat
`RuntimeEnv` pe `OutboxAdminContext`). `env` era deja prezent in contextul command-runtime prin
`MongoContextExports` (parte din `CommandRuntimeContext`), deci a fost suficient sa-l tipam pe contractul
handler-ului — fara a astepta migrarea completa la factory-uri. (2) Knob-urile cron (`CRON_CYCLE_BUDGET_MS`, `CRON_JITTER_MS`)
si worker (`NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS`, `NOTIFICATION_OUTBOX_LOCK_TTL_MS`) sunt deja citite prin
**`parseEnvNumber` injectat** (acelasi reader centralizat care construieste si `RuntimeEnv`, cu clamp),
la constructia controller-ului/worker-ului — nu sunt `process.env` raw imprastiate; pre-stocarea lor in
`RuntimeEnv` e o uniformizare cosmetica, nu o gaura de testabilitate (sunt deja injectabile prin `parseEnvNumber`).

**Limbaj.** Nu se adauga alt limbaj pentru zona asta: outbox/Discord/Mongo sunt I/O-bound, deci
TypeScript ramane alegerea corecta; orice candidat nou de Rust trece intai prin `npm run benchmark:cpu`
si prin decizia documentata in `BENCHMARKS.md` (politica existenta, reconfirmata in review #11.5).

**Re-confirmare (review manual R4 #5).** Un review ulterior a semnalat din nou cablarea dinamica a
registrului de comenzi (`commandRegistry`) ca zona de redus. Evaluarea de mai sus ramane valida:
tipizarea directa a compunerii e respinsa cu proba tsc (supratipul comun colapseaza in `never`/`any`),
iar pasul corect e DI per handler — nu o re-tipare a registrului progresiv. Niciun cod nou; problema
e deja urmarita aici.

## Separarea tipurilor brute de sursa de tipurile normalizate (datorie de tipare, review manual R12 #3)

**Starea curenta.** Cateva tipuri de domeniu din `types.ts` pastreaza inca un index `[key: string]: unknown`:
`GameConfig` (config + campuri per-sursa), `PatchUpdate` (iesirea bruta a scraper-elor), `DealInfo`
(oferta bruta de la Steam/Epic), `GuildSettings` (documentul Mongo). Indexul e un type-safe escape (nu
`any`, permis de regula 2) si reflecta realitatea ca **datele de sursa** au forme variabile/in evolutie.
Riscul semnalat: acelasi tip e folosit si ca model **normalizat** in interiorul botului, deci drift-ul de
schema/scraper se poate strecura nedetectat in logica normalizata.

**Ce e deja facut (pattern-ul tinta).** Pentru update-uri, separarea exista: `PatchUpdate` (brut, cu index)
-> `NormalizedUpdate` (inchis, exact `id`/`title`/`link`/`excerpt`/`fullText`/`image`/`thumbnail`/`timestamp`),
iar logica de notificari consuma `NormalizedUpdate`. Acelasi pattern trebuie extins:
- `DealInfo` (brut, scraper) -> un `NormalizedDeal` inchis, consumat de filtrare/embed/dedupe;
- `GuildSettings` -> un tip inchis pentru campurile pe care botul chiar le citeste (restul raman in stratul Mongo);
- `GameConfig` ramane cu index la **incarcarea** configului (sursa de adevar externa), dar consumatorii interni
  primesc un `Pick<>` ingust (ce folosesc efectiv), nu intregul `GameConfig`.

**De ce e amanat / efort dedicat.** Nu e o incalcare de reguli (indexul e permis), ci o strangere catre nota 10.
E un refactor mare: `GameConfig` apare in ~34 de fisiere, `DealInfo` in ~18, `GuildSettings` in ~13 — eliminarea
indexului cere auditarea fiecarui acces pe cheie dinamica si fie tiparea campului, fie un `Pick<>` la consumator.
Se face incremental, un tip pe rand (cum s-a facut `PatchUpdate`/`NormalizedUpdate`), cu suita verde la fiecare pas.

## Partitionarea `buildOptimizedGameList` (filtered vs unfiltered) la scara mare

**Starea curenta.** `updateNotificationService.buildOptimizedGameList(allGames, subscribedGuilds)` reduce,
la fiecare ciclu de cron, lista de jocuri fetch-uite la **uniunea** `enabledGames`-urilor tuturor guild-urilor
abonate. Daca **vreun** guild nu are filtru (`enabledGames` gol = „toate jocurile"), functia face early-exit
si intoarce `allGames` — deci un singur guild nefiltrat forteaza fetch-ul intregii liste. Calculul e O(guild-uri ×
marime-filtru) per ciclu, iar la volumul curent (putine guild-uri, putine jocuri) costul e neglijabil fata de
fetch-ul real (I/O-bound) si de rate-limit-ul Discord.

**Ce s-ar schimba.** La scara mare (multe guild-uri cu filtre diverse) s-ar separa **doua liste precomputate**:
(1) setul „unfiltered" (jocurile cerute de cel putin un guild fara filtru — mereu fetch-uite) si (2) setul
„filtered-only" (jocuri cerute doar de guild-uri cu filtru), recalculate doar cand se schimba configul de guild
(pe `guildCreate`/`/set games`/`/start`/`/stop`), nu la fiecare ciclu. Astfel un guild nefiltrat nu mai anuleaza
optimizarea pentru restul, iar uniunea nu se mai reconstruieste din zero per ciclu.

**Praguri de declansare (masurate, NU implementate acum).** Implementeaza partitionarea daca **oricare**:

- numarul de guild-uri abonate **> ~2.000** **si** o fractiune semnificativa (> 50%) au filtre `enabledGames`
  ne-goale (altfel early-exit-ul „un guild nefiltrat -> toate jocurile" domina si partitionarea nu ajuta); **sau**
- durata medie a unui ciclu de cron creste sustinut **si** profiling-ul arata `buildOptimizedGameList` /
  re-filtrarea per-guild ca o fractiune masurabila a ciclului (azi e zgomot fata de fetch + send).

Sub aceste praguri, recalcularea per-ciclu ramane alegerea corecta (mai simpla, fara stare derivata de
invalidat la fiecare schimbare de config). Constrangeri de pastrat la implementare: rezultatul per-guild
trebuie sa ramana identic (fiecare guild vede exact jocurile lui), iar invalidarea listelor precomputate la
schimbarea configului trebuie sa fie atomica (un `/set games` nu trebuie sa lase o lista derivata invechita).

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
