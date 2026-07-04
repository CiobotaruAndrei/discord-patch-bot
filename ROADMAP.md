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

## Migrarea registrelor la factory-uri per handler/sursa (REZOLVATA)

**Starea curenta — `commandRegistry` si `sourceRegistry` MIGRATE.** Ambele registre de wiring compun
acum **explicit**, fara mecanismul de installers dinamici. `commandRegistry` nu mai foloseste
`installers: unknown[]` + apel dinamic + `as` de narrowing pe `CommandInstallerTarget`: compune explicit
prin factory-uri reale tipate (`createCommandCache`, dealFilters, `createCommandPresentation`,
`createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) compuse **imutabil**
intr-un `createAppServices()` dedicat — fiecare zona se obtine prin **spread in obiecte noi**
(`{ ...prev, ...createX(prev) }`), nu prin `Object.assign(base, ...)` care muta in loc un singur obiect
partajat; registrul public returnat e `Object.freeze`-uit (consumatorii nu mai pot muta wiring-ul). Singurul
seam de mutatie ramas e late-binding-ul `handleInteraction`/`buildHelpEmbed` + guard-urile pe `ctx`
(recursie mutuala dispatcher<->handlers, izolata si explicita). Plus o **lista tipata `CommandHandler[]`** (din `attachX.buildCommandHandler(ctx)` pentru
cele 15 handler-e) rutata de `dispatchCommand` (loop `canHandle`/`handle`, fallback-ul ultimul), cu
pre-check-ul admin (`requireGuildAdmin`, `adminCommandRouterGuard`) ca **singur wrapper** peste
`dispatchCommand` — nu mai e un lant ordonat-sensibil care impacheteaza `handleInteraction`. Intoarce
contractul **inchis** `RequiredCommandRegistry` (`handleInteraction`/`buildHelpEmbed` cerute fail-fast prin
`requireInstalled`). `sourceRegistry`
(`createSourceRegistry(): SourceRegistryApi`, fara parametri) nu mai are `SourceInstaller[]` /
`defaultInstallers` / bucla dinamica: compune prin apeluri `attach*(context)` **ordonate**
(`http -> steam -> updates -> deals`, in ordinea dependentelor) si extrage exportul inchis prin
`buildSourceRegistry`/`requireSourceValue` (fail-fast pe cheie lipsa). Intreaga compunere a ambelor e
verificata de `tsc`, nu de un boundary `unknown[]`. Zero `as never` / `as unknown as` ramane impus de
`check:weakening` (gate AST) plus gardul `registryClosedContracts.test.ts` (care pinuieste si absenta
`SourceInstaller`/`defaultInstallers` + apelurile `attach*` ordonate).

**Cum a fost deblocata tiparea directa.** Estimarea anterioara (supratipul comun colapseaza in
`never`/`any`, deci ar fi nevoie de DI per handler) s-a dovedit **prea pesimista**: compunerea explicita a
trecut reconciliind, dep cu dep, fiecare contract de handler la semnatura factory-ului real — fie
stramtand deps-urile loose la tipul real (functii contravariante, ex. `dealPassesFilters`,
`buildUpdateEmbed`), fie prin segregare de interfata (contracte minimale ca `SteamPriceData`,
`EmbeddableUpdate`, modelele Mongo reduse la `OutboxRuntimeDeps`/`HistoryRepositoryDeps`), fie unificand
tipurile duplicate care divergeau (`PendingUpdate`/`PendingDiscount` la alias-uri `types.*`). Nu a fost
nevoie de niciun `as` pe boundary; `tsc` verifica acum compunerea end-to-end.

**`sourceRegistry` — REZOLVAT (inclusiv pasul factory-return).** Boundary-ul dinamic (`SourceInstaller[]`
+ `defaultInstallers` + bucla `for (install of installers)`) a fost eliminat, iar compunerea foloseste acum
**valorile returnate de factory-uri**, nu mutatie pe context: fiecare modul de sursa (`infra/http/client`,
`sources/steam`/`updates`/`deals`) expune un `buildFrom(context)` care **intoarce** contributia (`createX`-ul
sau), iar `attachX` deleaga la el (`Object.assign(target, buildXFrom(target))`) — maparea de deps traieste
intr-un singur loc, fara duplicare. `createSourceRegistry()` compune **imutabil**, ordonat
(spread in obiecte noi `{ ...prev, ...attach*.buildFrom(prev) }`, fara `Object.assign(context, ...)` in-place,
`http -> steam -> updates -> deals`) si intoarce un `SourceRegistryApi` inchis si **`Object.freeze`-uit** prin `buildSourceRegistry`/`requireSourceValue`. Compunerea a typecheck-uit direct
(fara cascada, fara `as`). `check:weakening` + gardurile din `registryClosedContracts.test.ts` (absenta
`SourceInstaller`/`defaultInstallers` + compunere prin `build*From` ordonate) mentin starea. Ambele registre
sunt acum complet pe factory-return explicit.

**`mongoContext` — REZOLVAT complet pe factory-return (pasul final, ca `sourceRegistry`).**
Pasul 1 (PR #477) a scos boundary-ul dinamic (`defaultInstallers: MongoInstaller[]` + bucla `for (install of
installers)` peste singletonul `runtime`), trecand la apeluri explicite ordonate `attachX(context)` pe o copie
proaspata. Pasul 2 (review #21 #5) duce compunerea **pana la capat**, exact ca `sourceRegistry`: fiecare modul
installer (cele 4 din `shared/` + cele 7 din `infra/mongo/`) expune acum un `buildFrom(context)` care **intoarce**
contributia, iar `attachX(target)` deleaga la el (`Object.assign(target, buildXFrom(target))`). `createMongoContext`
compune prin **spread in obiecte noi** (`{ ...prev, ...attachX.buildFrom(prev) }`) in ordinea dependentelor
(`logging -> domain -> env -> utilities -> models -> locks -> migrations -> systemState -> guildSettings ->
adminAlerts -> fetchSnapshots`), fara nicio mutatie pe un context partajat in timpul compunerii, si intoarce un
export `Object.freeze`-uit. Ordinea garanteaza ca niciun `buildFrom` nu citeste un camp adaugat ulterior (fara
forward-reference; echivalenta de comportament confirmata de suita completa, incl. testele de integrare Mongo).
Modulele Mongo/shared **isi pastreaza** adaptorul `attachX(target)` ca thin-wrapper fiindca e folosit si direct
de scripturi/teste de integrare (`check-db-indexes`, `acquireDbLock`, `guildSettingsCache`, `outboxMongoIndex`).
Gardat de `registryClosedContracts.test.ts` (compunere prin `build*From` ordonat, fara `attachX(context)`, export
inghetat). Toate cele trei zone de compunere (`commandRegistry`, `sourceRegistry`, `mongoContext`) sunt acum pe
factory-return explicit.

**Izolarea compat `attachX` — EVALUAT (R4 #15), apoi PAS EXECUTAT (R5 #3: factory-only pe modulele numite).**
In runda 5, cele trei module numite explicit de review au trecut complet pe factory-only, fara nicio forma de atasare
pe target: `features/notifications/index` (export `{ createNotificationRuntime, createIsStillSubscribed,
outboxSubscriptionFilter }`), `features/command-cache/commandCache` (export `{ createCommandCache,
computeMissingChannelPerms, formatMissingChannelPerms }`) si `infra/mongo/models` (export `{ buildFrom }`).
Consumatorii lor directi (2 teste e2e, `check-db-indexes`, `outboxLoadBenchmark`, 6 teste de integrare) au fost
migrati pe factory/`buildFrom` si isi fac singuri `Object.assign` pe contextul propriu; gardat de
`commandInstallerTargetContracts.test.ts`. Evaluarea initiala R4 #15 ramane valabila pentru restul adaptoarelor: Punctul cerea izolarea
adaptoarelor de compatibilitate `attachX`. Evaluare pe cod real: productia **nu** mai compune prin `attachX(context)`
(sourceRegistry compune prin `build*From` in 4 pasi, `mongoContext` in 11, `commandRegistry` prin factory-uri tipate +
`CommandHandler[]`), deci `attachX(target)` nu mai are rol de compunere in runtime. Adaptoarele raman **thin-wrappers**
(`Object.assign(target, buildXFrom(target))`) folosite direct doar de **2 scripturi** (`check-db-indexes`,
`outboxLoadBenchmark`) si de **~13 teste** integration/functional (`acquireDbLock`, `adminAlerts`, `fetchSnapshots`,
`guildSettingsCache`, `mongoMigrations`, `outboxMongoIndex`, `outboxMultiInstance`, `systemStatePerKey` etc.), care
exercita un singur modul mongo in izolare fara sa porneasca tot contextul. Eliminarea lor ar forta acei ~15 consumatori
sa booteze contextul complet sau sa duplice wiring-ul — deci adaptoarele isi platesc rolul de seam de testabilitate si
raman justificate. Nota: `attachMetrics` (`app/health/metrics` prin `createMetrics()` + setter-ul de pe scraper/http
runtime) este injectie DI la runtime a referintei partajate `BotMetrics`, **nu** un adaptor de compunere legacy — nu
intra sub acest punct. Invariantul (compunere imutabila, fara mutatie de context) este deja pinuit de
`registryClosedContracts.test.ts`; nu e nevoie de cod nou.

**`createAppServices()` imutabil — IMPLEMENTAT (review manual R14 #4, Low).**
`createCommandRegistry` muta anterior **un singur obiect `base`** prin lantul
`Object.assign(base, attach*.createX(base))` (`withCache -> withFilters -> ...`): contextul era mutabil si
fiecare strat vedea/putea muta campurile celorlalte. Acum compunerea zonelor traieste intr-un
`createAppServices()` dedicat, unde fiecare zona se obtine prin **spread in obiecte noi**
(`{ ...prev, ...createX(prev) }`) — fara mutatie in-place a unui base partajat — iar `createCommandRegistry`
intoarce un obiect **`Object.freeze`-uit** (consumatorii nu mai pot muta wiring-ul dupa compunere). Singurul
seam de mutatie ramas e late-binding-ul `handleInteraction`/`buildHelpEmbed` + guard-urile pe `ctx` (recursie
mutuala dispatcher<->handlers, izolata si explicita). Fara schimbare de comportament (intreaga suita trece
neschimbata). Gardat de `commandRegistry.functional.test.ts` (registru inghetat) +
`registryClosedContracts.test.ts` (compunere prin `createAppServices`, fara `Object.assign(base, ...)`).

**Boundary-urile `& Record<string, unknown>` ale adaptoarelor (urmatorul pas catre nota 10).** Acelasi
tipar de installer `attachX` largeste contextul de instalare la `Deps & Record<string, unknown>` ca sa
accepte cheile adaugate progresiv: `NotificationsContext` (`notifications/index.ts`), `HttpClientContext`
(`infra/http/client.ts`). **Pasi siguri facuti (review manual R11 #4 + #5):** (a) `sourceRegistry` —
`SourceRuntimeContext` a fost stramtat din `Partial<SourceRegistryApi> & runtime & Record<string, unknown>`
la exact `Partial<SourceRegistryApi> & runtime` (installer-ele de surse nu adaugau chei in afara API-ului,
deci indexul larg era inutil); (b) `commandRegistry` — campurile de iesire tipate generic cu
`RegistryFunction = (...args: unknown[]) => MaybePromise<unknown>` au primit semnaturi precise
(`cleanCache: () => void`, `buildSlashCommandDefinitions: () => unknown[]`, `getFindGameCacheSize: () => number`
etc.), iar tipul generic a fost eliminat. **Ce ramane** (boundary-ul de instalare dinamic in sine) a fost
**rezolvat pentru `commandRegistry`** prin compunerea explicita de mai sus — `installers: unknown[]` +
apelul dinamic au disparut, iar `tsc` verifica fiecare factory. Mai raman `& Record<string, unknown>`-urile
adaptoarelor `attachX` care alimenteaza `sourceRegistry` si `NotificationsContext` / `HttpClientContext`
(index type-safe, nu `any`, permis de regula 2); dispar odata cu migrarea explicita a `sourceRegistry`.
Gardat de `registryClosedContracts.test.ts` (fara `Record<string, unknown>` pe `SourceRuntimeContext`,
fara `CommandInstallerTarget` / `isCommandModuleInstaller` / `installers` in `commandRegistry`).

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

**Rezolvat (migrarea `commandRegistry`).** Un review ulterior (R4 #5) semnalase din nou cablarea dinamica a
registrului de comenzi ca zona de redus. Estimarea de atunci (tipizarea directa respinsa cu proba tsc, DI per
handler obligatoriu) a fost depasita: compunerea explicita a `commandRegistry` e acum completa, reconciliind
fiecare contract de handler la factory-ul real (stramtare de deps + segregare de interfata + unificare de
tipuri duplicate), fara `as` pe boundary. `sourceRegistry` a fost migrat la fel (apeluri `attach*`
explicite ordonate, fara `SourceInstaller[]`), typecheck direct fara cascada — ambele registre sunt acum
explicite.

## Separarea tipurilor brute de sursa de tipurile normalizate (datorie de tipare, review manual R12 #3)

**Starea curenta.** Cateva tipuri de domeniu pastreaza inca un index `[key: string]: unknown`:
`GameConfig` (config + campuri per-sursa, in `types.ts`), `PatchUpdate` (iesirea bruta a scraper-elor) si
`DealInfo` (oferta bruta de la Steam/Epic) — ambele in `sources/sourceTypes.ts`, re-exportate prin
agregatorul `types.ts` — si `GuildSettings` (documentul Mongo, in `types.ts`). Indexul e un type-safe escape (nu
`any`, permis de regula 2) si reflecta realitatea ca **datele de sursa** au forme variabile/in evolutie.
Riscul semnalat: acelasi tip e folosit si ca model **normalizat** in interiorul botului, deci drift-ul de
schema/scraper se poate strecura nedetectat in logica normalizata.

**Ce e deja facut (pattern-ul tinta).** Pentru update-uri, separarea exista: `PatchUpdate` (brut, cu index)
-> `NormalizedUpdate` (inchis, exact `id`/`title`/`link`/`excerpt`/`fullText`/`image`/`thumbnail`/`timestamp`),
iar logica de notificari consuma `NormalizedUpdate`. **Vederile loose redundante de pe calea update au fost
eliminate:** `UpdateFetchResult` (`pendingUpdatesQueue`) si `UpdateRecord` (`latestUpdatesHandler`) tipau
`latest` ca `({ id: string } & Record<string, unknown>) | null` desi sursele produc deja `FetchResult`
(`latest: NormalizedUpdate`); sunt acum alias-uri `= FetchResult`, deci calea update e complet normalizata
end-to-end (a fost si pasul care a deblocat compunerea explicita a `commandRegistry`). Acelasi pattern trebuie extins:
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

## Catalog unic de comenzi — re-evaluat si respins din nou, cu garantii echivalente prin verificare (review runda 3, items 1 + 12)

**Cererea din review.** O sursa unica `commandCatalog` tipata din care sa derive slash definitions,
help-ul, regulile de acces, autocomplete-ul de snooze, verificarile din docs si acoperirea de routing;
plus generarea tabelului `docs/Comenzi Functionalitate.md` din catalog in loc de intretinere manuala.

**Verdictul (regula 20, re-evaluat pe starea curenta).** Respins din nou, din aceleasi motive ca la
prima evaluare, care raman valabile si dupa spargerea definitiilor pe domenii:

1. **Handler-ele nu sunt 1:1 cu comenzile** (un handler acopera zeci de subcomenzi `/set`; fallback-ul
   e catch-all pozitional), deci un catalog nu poate deriva rutarea fara sa ascunda exact invariantele
   semantice care conteaza (ordinea listei de handler-e).
2. **Riscul real este drift-ul silentios, nu duplicarea in sine** — iar drift-ul e deja imposibil de
   introdus fara sa pice CI: manifestul de acces ⇔ slash definitions ⇔ help catalog ⇔ tabelul din docs
   (coloana Permisiuni + prezenta bidirectionala) sunt sincronizate prin teste dedicate, acoperirea de
   routing e gardata de `commandHandlerCoverage.test.ts` (orice comanda noua fara handler dedicat pica
   CI cu numele caii lipsa), iar modulele de definitii pe domenii sunt gardate de
   `slashDefinitionsDomainSplit.test.ts` (nume unice, compozitie = reuniune).
3. **Generarea tabelului din docs ar pierde curatoria manuala**: descrierile din
   `docs/Comenzi Functionalitate.md` sunt formulate editorial (nu identice cu help-ul), iar testul de
   sincronizare existent verifica deja bidirectional prezenta comenzilor si permisiunile — partea care
   poate drifta periculos. Un generator ar inlocui text curat de om cu text de catalog fara sa adauge
   vreo garantie noua.

**Ce s-ar schimba daca apare nevoia reala.** Daca numarul de comenzi creste semnificativ sau apare un
al doilea consumator de metadate (ex. un dashboard web), catalogul devine justificat: pasul corect ar fi
sa se extinda `commandAccessManifest` (deja tipat si central) cu descrieri si optiuni, apoi help-ul si
definitiile sa se mute treptat pe el, pastrand guard-urile existente ca plasa de siguranta in tranzitie.

## Unit-of-work atomic pentru operatiile multi-step (audit R5 #7)

Auditul fluxurilor numite de review si starea lor (Mongo standalone, fara tranzactii —
strategia repo-ului e claim/rollback explicit + scrieri combinate pe acelasi document):

- **YouTube subscribe (baseline + abonare)** — REZOLVAT anterior: claim atomic cu limita
  (`findOneAndUpdate` conditionat), iar la esec baseline-ul seen abia scris e curatat
  (rollback, cu erorile de rollback logate best-effort). Gardat de
  `youtubeSubscriptionInteraction.functional.test.ts`.
- **Price-alert trigger + starea seen** — REZOLVAT anterior: trecerea sub prag e revendicata
  atomic per regula (`rollbackTriggeredAlert` la esec de livrare, re-arm dupa revenirea peste
  prag). Gardat de `priceAlertService.functional.test.ts`.
- **Backup load/delete + audit server-log** — IMPLEMENTAT in R5 #7: restore-ul si intrarea de
  audit sunt pe ACELASI document guild, deci acum sunt o singura scriere `updateOne`
  (`loadConfigBackupWithAudit`: `$set`/`$unset` + `$push serverAuditLog`;
  `deleteConfigBackupWithAudit`: filtru pe existenta backup-ului + `$pull` + `$push`, deci
  auditul nu se scrie pentru un delete inexistent, iar `matchedCount` da raspunsul "Nu exista").
  Ambele-sau-niciuna: a disparut calea degradata "restaurat dar fara audit".
- **Config reset + curatarea replay payloads** — RAMANE compensare explicita: reset-ul e o
  singura scriere `$set` pe documentul guild, dar payload-urile de replay sunt alta colectie
  (`notificationDeadLetterReplay`); fara tranzactii cross-colectie, esecul curatarii e raportat
  ONEST userului ("Partial: ... reincearca /outbox clear-deadletters") — acesta e design-ul,
  nu un gap.
- **Report resolve + log** — RAMANE best-effort cross-colectie: resolve-ul e
  `findOneAndUpdate` atomic pe colectia de rapoarte; jurnalul de comenzi admin (bot-log) e
  scris de router guard pe documentul guild, alta colectie. Aceeasi limitare de tranzactii;
  auditul e jurnal operational, nu sursa de adevar, deci best-effort e suficient.

**Cand ar deveni relevante tranzactiile reale:** daca deployment-ul trece pe replica set,
perechile cross-colectie (reset + replay cleanup; resolve + log) pot deveni tranzactii — dar
sub un singur nod Mongo, combinatia scriere-unica-pe-document + compensare raportata onest
ramane corecta si mai simpla.

## Catalog unic per comanda (definition + help + handler + accessPolicy) — EVALUAT (R5 #5): RESPINS/AMANAT

Propunerea: fiecare comanda sa exporte impreuna `definition`, `help`, `handler` si `accessPolicy`,
iar registry-ul sa compuna din acele module. Evaluare pe cod real: **garantia urmarita (o singura
sursa, fara drift intre cele patru fatete) exista deja**, obtinuta altfel:

- `COMMAND_ACCESS_MANIFEST` + `COMMAND_CATALOG_HELP` (command-catalog) sunt sursa unica pentru
  acces + help: din ele deriva `/help` (`COMMAND_HELP_ENTRIES`), etichetele de permisiuni,
  guard-urile runtime (router/owner/sensitive prin `commandAccessManifest`) si referinta
  generata `docs/Referinta Comenzi.md` (cu `check:docs-commands` anti-drift in CI).
- Sincronizarea catalog <-> slash definitions <-> handlere e impusa de teste care parcurg
  definitiile reale (`commandHelpCatalog.test.ts`, `commandAccessManifest.test.ts`,
  `commandCatalog.test.ts`, `commandRouting.test.ts`): o comanda noua fara intrare de
  help/acces PICA suita — driftul pe care l-ar preveni colocarea e deja imposibil.
- Costul colocarii: ~122 de comenzi / 40+ fisiere de handler + definitiile grupate
  intentionat pe domenii (dupa restructurarea add/remove) ar fi rescrise mecanic, fara nicio
  garantie noua.

**Declansator de revizuire:** daca adaugarea de comenzi noi arata frictiune reala pe care
gardurile n-o prind (o fateta lipsa nedetectata), colocarea redevine candidat.

## `Result<T, E>` / `SourceResult` pentru sursele externe — EVALUAT (R5 #8): RESPINS/AMANAT

Propunerea: tip `SourceResult` in loc de throw/catch in `sources/updates` si `sources/deals`.
Evaluare pe cod real: **granita consumatorului are deja un result-type**:

- Circuit breaker-ul intoarce `FetchResult { game, latest, error: string | null }` — cron-ul
  si dispatch-ul nu primesc niciodata exceptii de la surse, ci date; fallback-chain-ul
  agrega esecurile fallback-urilor in mesajul erorii primare.
- Taxonomia erorilor exista si e actionabila: `SchemaDriftError` vs esec tranzitoriu
  (alerte `drift:` vs `cb:`), metrici Prometheus per-sursa si per-tip-de-eroare, praguri
  separate de circuit breaker si de schema drift.
- In interiorul scraperelor, exceptiile raman transportul natural (axios/cheerio/parsere
  arunca oricum); convertirea intregului lant (`conditionalGet`, `fetchWithProxy`, parserele
  per-sursa) la `Result` ar fi churn mare fara predictibilitate noua — punctul UNIC in care
  eroarea devine data e boundary-ul CB, deja testat (`updatesCircuitBreaker.test.ts`,
  `perSourceConcurrency.test.ts`, `sourceScraperShapeDrift.test.ts`).

**Declansator de revizuire:** daca un tip nou de drift are nevoie de date structurate mai bogate
decat ierarhia de clase de eroare + `FetchResult.error` (ex. cod masina + context de retry
per-camp), boundary-ul CB e locul unde s-ar introduce un `SourceResult` imbogatit — nu scraperele.
