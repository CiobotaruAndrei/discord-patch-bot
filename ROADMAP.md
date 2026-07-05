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

**Confirmat la review R7 (#15).** Reviewerul a cerut batch claim „doar daca apar metrice care o
justifica" — exact gating-ul de mai sus: pragurile pe `/metrics` + alerta `OutboxBatchDrainRecommended`
sunt declansatorul, nu o decizie speculativa. Nimic de schimbat.

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

**Re-verificat la review R7 (#1) + pas exemplar pe handler-e.** Cererea („eliminarea completa a
stilului vechi de installer/context in commandRegistry — handlers atasati pe context,
previousHandleInteraction, Object.assign, install dinamic → createXHandler(deps) + rutare tipata")
a fost re-verificata pe cod (regula 20): pentru **registry** e deja starea repo-ului — zero
`previousHandleInteraction`/`Object.assign(target, ...)` in `commandRegistry.ts`, compunere prin
factory-uri tipate + lista `CommandHandler[]` rutata de `dispatchCommand`. Rezidualul real sunt
**install-form-urile de pe modulele de handler** (callable-ul `installX(target)` cu lantul
`previousHandleInteraction`), pastrate DOAR ca seam de test — productia nu le apeleaza. Pas
exemplar executat: `latestInteractionHandler` a trecut pe **factory-only**
(`export = { createLatestInteractionHandler, buildCommandHandler }`, installer-ul sters), iar
testul lui functional isi construieste explicit lantul din `buildCommandHandler` — acelasi tipar
ca migrarea surselor (R5 #3/R6 #1). Restul handler-elor se migreaza per modul, cand se atinge
modulul (acelasi ritm ca la repositories), nu big-bang: fiecare are teste care apeleaza forma de
install si trebuie repointate individual (regula 8).

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
end-to-end (a fost si pasul care a deblocat compunerea explicita a `commandRegistry`). Acelasi pattern extins:
- `DealInfo` — EXECUTAT (runda 10): index signature-ul `[key: string]: unknown` a fost eliminat, iar
  `DealInfo` e acum un tip INCHIS consumat de filtrare/embed/dedupe. S-a dovedit ca niciun consumator nu se
  baza pe chei dinamice tipate (compilarea a trecut fara nicio modificare de call-site; casturile explicite
  `item as DealInfo` de la snapshot-urile Mongo raman escape-ul corect pentru date dinamice).
  `ValidatedDealInfo`/`EnrichedDealInfo` raman rafinari (`extends DealInfo`). Gardat de un test in
  `domainTypesLocality.test.ts` (DealInfo fara index signature).
- `GuildSettings` -> un tip inchis pentru campurile pe care botul chiar le citeste (restul raman in stratul Mongo);
- `GameConfig` ramane cu index la **incarcarea** configului (sursa de adevar externa), dar consumatorii interni
  primesc un `Pick<>` ingust (ce folosesc efectiv), nu intregul `GameConfig`.

**De ce restul e amanat / efort dedicat.** Nu e o incalcare de reguli (indexul e permis), ci o strangere catre
nota 10. `GuildSettings` (~56 de fisiere) si `GameConfig` (~34) raman refactoruri mari: eliminarea indexului cere
auditarea fiecarui acces pe cheie dinamica si fie tiparea campului, fie un `Pick<>` la consumator. Se face
incremental, un tip pe rand (cum s-a facut `PatchUpdate`/`NormalizedUpdate` si acum `DealInfo`), cu suita verde
la fiecare pas — declansatorul practic e atingerea zonei respective sau un bug de cheie dinamica gresita.

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

**Confirmat la review R7 (#14).** Reviewerul a cerut explicit ca Rust sa NU fie extins dincolo
de hot-path-urile masurate — exact politica documentata aici si in sectiunea TS-primary de mai
jos: extinderea se face doar pe baza de benchmark (`npm run benchmark:cpu`) cu castig dovedit,
nu pe preferinta de limbaj (regula 9: un limbaj nu inlocuieste altul decat daca inlocuitorul e
masurabil mai bun pe zona respectiva).

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

## Unit-of-work atomic pentru operatiile multi-step (audit R5 #7, extins la R7 #13)

Auditul fluxurilor numite de review si starea lor (Mongo standalone, fara tranzactii —
strategia repo-ului e claim/rollback explicit + scrieri combinate pe acelasi document):

- **Start/stop abonari (updates + reduceri)** — IMPLEMENTAT in R7 #4: tranzactia de stare
  (activare cu `activationId`, finalize conditionat de activation-id, rollback cu `lastError`,
  stop cu golirea pending-ului) traieste in `features/notifications/subscriptionService.ts`
  ca use-case explicit cu rezultat tipat (`activated`/`superseded`/`baseline-failed`), separat
  de prezentarea Discord. Gardat de `subscriptionService.test.ts` + testele functionale de
  subscriptie.
- **Price-alert add/remove** — REZOLVAT in R6 #6: `upsertPriceAlert` foloseste pipeline-ul
  atomic cu conditie de dimensiune (`buildPriceAlertUpsertPipeline`, max 25/guild intr-o
  singura scriere), `removePriceAlertsForGame` e un singur `updateOne`. Gardat de
  `guildRepositories.test.ts`.
- **Suggest-command delete + watchlist-game delete + audit server-log** — IMPLEMENTAT in
  R7 #13: `$pull`-ul si intrarea de audit (`suggest_command_delete`/`watchlist_game_delete`)
  sunt in ACELASI `updateOne`, cu filtru pe existenta intrarii — auditul nu se scrie pentru un
  delete inexistent, iar `matchedCount` da raspunsul "Nu am gasit". Acelasi tipar ca backup
  delete (R5 #7) si regulile de acces admin (R6 #7). Bot-log-ul ("Access granted.") ramane
  jurnal best-effort separat, prin design.
- **Outbox replay/dead-letter** — REZOLVAT anterior, per-item prin design: replay-ul valideaza
  fiecare payload cu guard-ul structural si sare intrarile nelivrabile cu WARN (R4 #5),
  dead-letter-ul se inregistreaza INAINTE de stergerea jobului pe toate caile terminale
  (R4 #3), iar esecurile de scriere sunt contorizate in metrici (`deadLetterFailures`,
  `deleteFailures`). Coada si istoricul sunt colectii diferite — compensare raportata onest,
  nu tranzactie.

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
- **Config reset + audit** — IMPLEMENTAT in R6 #7: reset-ul si intrarea de audit `reset_config`
  sunt acum o singura scriere (`$set` + `$push serverAuditLog` in acelasi `updateOne`); la fel
  `admin_access_set`/`admin_access_delete` pentru regulile de acces admin. Curatarea replay
  payloads RAMANE compensare explicita: alta colectie (`notificationDeadLetterReplay`), fara
  tranzactii cross-colectie, esecul e raportat ONEST userului ("Partial: ... reincearca
  /outbox clear-deadletters").
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

**Declansatorul S-A ACTIVAT si pasul a fost executat (R6 #9):** review-ul urmator a cerut exact
taxonomia structurata, asa ca boundary-ul CB clasifica acum fiecare rezultat: `FetchResult.outcome:
"ok" | "transient-error" | "permanent-error" | "schema-drift" | "rate-limited"` (clasificator pur in
`sources/sourceOutcome.ts`: 429/rate-limit → rate-limited; "Tip necunoscut" → permanent; SchemaDriftError
→ schema-drift; cooldown-ul propriului breaker → rate-limited; restul → transient). Exact cum era
planificat: imbogatirea s-a facut LA BOUNDARY, nu in scrapere — scraperele raman pe exceptii.
Consumatorii (/sources status, canary, admin alerts, politici de retry) pot adopta `outcome` treptat.

**Declansator de revizuire:** daca un tip nou de drift are nevoie de date structurate mai bogate
decat ierarhia de clase de eroare + `FetchResult.error` (ex. cod masina + context de retry
per-camp), boundary-ul CB e locul unde s-ar introduce un `SourceResult` imbogatit - nu scraperele.

## Migrarea completa la ESM - EVALUAT (R6 #10): RESPINS/AMANAT

Tinta propusa ("ESM/factory-only complet") are doua jumatati cu sorti diferite:

- **Factory-only: EXECUTAT progresiv** (R5 #3 + R6 #2 + R6 #10-parte): notifications/index,
  commandCache, models, commandSnoozeGuard si acum sources/steam + sources/deals +
  sources/updates exporta doar obiecte de factory-uri (`{ buildFrom, create*, statics }`),
  fara callable de atasare; consumatorii de test au fost migrati pe `buildFrom` cu downcast-ul
  acceptat (un singur `as`, `Record & Ctx`). Seam-urile ramase cu install-form (handler-ele de
  comenzi, slashCommandDefinitions, dealFilters, adminCommandRouterGuard, modulele Mongo/shared
  per-instanta) au fiecare apelanti reali de test si sunt documentate ca granita.
- **ESM propriu-zis: RESPINS.** Repo-ul e CommonJS deliberat (`tsconfig module: commonjs`,
  idiomul `export =` + `require(...) as typeof import(...)` care face wiring-ul verificabil de
  tsc, addon-ul NAPI incarcat cu `require`, suita rulata pe `dist/` cu node --test). Migrarea la
  ESM ar churn-ui fiecare modul si scripturile de build/test pentru zero castig functional;
  devine relevanta doar daca un dependency major devine ESM-only fara alternativa CJS.

## Acces Mongo prin repositories pe documentul Guild (plan R6 #6)

Pas executat in R6 #6 (exemplarele): `command-security/adminAccessRepository.ts` (citirea canonica
`loadAdminAccessDoc` - consolidata din DOUA implementari duplicate, resolver + handler - plus
`saveAdminAccessRule`/`deleteAdminAccessRule` cu auditul atomic din R6 #7) si
`features/notifications/priceAlertRepository.ts` (`buildPriceAlertRule`/`buildPriceAlertUpsertPipeline`
mutate + `upsertPriceAlert`/`removePriceAlertsForGame`); handler-ele delega, testele functionale trec
neatinse. Repositories deja existente dinainte: seenRepository, youtubeRepository,
configBackupRepository, auditLogRepository, feedbackRepository, historyRepository,
deadLetterReplayRepository.

**Pas executat in R7 #3 (etapa GuildConfig):** modul nou `features/guild-config/` —
`guildConfigDefaults.ts` (sursa unica a valorilor implicite per server, `buildResetConfiguration`
mutat 1:1 din handler) + `guildConfigRepository.ts` (`resetGuildConfigurationWithAudit` — reset +
audit `reset_config` in acelasi `updateOne`, decizia R6 #7 pastrata — si `setAdminAlertChannel`).
`guildConfigurationAdminHandler` delega; snapshot-urile si auditul erau deja repositories
(`configBackupRepository` = Snapshot, `auditLogRepository` = Audit), deci fatetele cerute de
review (Defaults/Repository/Snapshot/Audit) au acum fiecare modulul ei.

**Candidatii, actualizati la runda 10 (inchiderea amanarilor):**
- `NotificationSubscriptionRepository` — EXECUTAT: updates/reduceri in `subscriptionService`
  (R7 #4), iar DLC + player-count mutate acum in acelasi serviciu (`startDlc`/`stopDlc`,
  `addPlayerCountGame`/`setPlayerCountGames`); familiile raman doar prezentare.
- Scrierile de configurare YouTube — ERAU DEJA EXECUTATE (amanare stale): exista
  `features/youtube/youtubeGuildConfigRepository.ts` (notify channel/enabled, template, filtre,
  rute, title-filters), iar comenzile din `command-handlers/youtube/` deleaga la el.
- restul `GuildConfigRepository`: scrierile din `/set` (mode/filters/currency/stores/games) din
  setInteractionHandler — singurul candidat ramas, in lucru in aceeasi runda.

## Tipuri brute vs normalizate (`DealInfo`/`GameConfig`/`GuildSettings`) — EVALUAT (R6 #5): AMANAT cu plan

Pattern-ul cerut (`PatchUpdate` → `NormalizedUpdate`) exista deja PARTIAL si pe deals:
`DealInfo` → `ValidatedDealInfo` → `EnrichedDealInfo` (sursele produc brut, validarea filtreaza,
enrichment-ul imbogateste). Zonele dinamice ramase sunt intentionate si ancorate:

- `GameConfig` `[key: string]: unknown` — cheile extra vin din `config.json` (validat de zod in
  `configValidator`); pasul urmator natural: un `NormalizedGameConfig` STRICT produs de
  `loadConfig` dupa validare (fara index-sig), consumat de fetchers — de facut cand se atinge
  `config/` (ripple pe ~76 de consumatori ai `GameConfig`).
- `GuildSettings` index-sig — documentul Mongo real are campuri istorice; gardul
  `registryClosedContracts` ancoreaza explicit decizia ("poarta index-sig"). Normalizarea ar
  cere un strat read-model per domeniu — directia deja inceputa cu repositories (R6 #6);
  se face treptat, per repository, nu big-bang.

**Declansator:** un bug real cauzat de o cheie dinamica gresita (azi prinse de validare/garduri).

**Re-verificat la review R7 (#11).** Cererea ("DTO-uri brute per sursa — SteamRawDeal,
CheapSharkRawDeal, YoutubeFeedEntry — in loc de `Record<string, unknown>` la parse") a fost
verificata din nou pe cod (regula 20): DTO-urile brute per sursa EXISTA deja si sunt folosite la
fiecare parse — `SteamSearchResponse`/`SteamAppDetailsResponse`/`SteamFeaturedCategoriesResponse`/
`SteamReviewResponse` (Steam), raspunsul GraphQL Epic, `FortniteBlogResponse`/`MinecraftVersionManifest`
(platforme), `YouTubeFeedItem` (feed-ul Atom) — toate mapate la modelele normalizate
(`DealInfo` → `ValidatedDealInfo` → `EnrichedDealInfo`, `NormalizedUpdate`, `YouTubeVideo`).
CheapShark NU exista ca sursa in repo (exemplu inventat de review). In `sources/` nu mai exista
`Record<string, unknown>` la parse — raman doar tipurile de context si semnaturile documentate mai
sus (`GameConfig`/`GuildSettings` cu index-sig), pentru care planul si declansatorul de mai sus
raman neschimbate.

## Split-ul handler-ului YouTube pe use-case-uri — CONFIRMAT LIVRAT (re-cerut la R7 #9)

Cererea ("sparge handler-ul de interactiuni YouTube in use-case-uri: subscribe/unsubscribe,
configurare notificari, filtre, erori/permisiuni") a fost verificata pe cod (regula 20): e DEJA
livrata dintr-o runda anterioara de arhitectura. `youtubeInteractionHandler.ts` are 118 linii si
e doar router-ul subtire; use-case-urile traiesc in `command-handlers/youtube/`:
`youtubeSubscriptionCommands.ts` (subscribe/unsubscribe, cu subscribe ca unitate logica cu
rollback pe baseline-ul seen), `youtubeNotifyCommands.ts` (notify/message-template/channel-route),
`youtubeFilterCommands.ts` (filter/title-filter), `youtubeManualVideoCommands.ts` (videos show),
`youtubeDiagnosticsCommands.ts` (errors/permissions), `youtubePresentation.ts` (list/status) si
`youtubeCommandTypes.ts` (contractele). Testele sunt si ele pe module
(youtubeSubscriptionInteraction/Config/ManualVideos + test kit). Nimic de facut.

## Testele functionale de 400-500 de linii — EVALUAT (R6 #12): AMANAT (chiar reviewerul: "nu e urgent")

Ramase: `youtubeNotificationService` (505), `youtubeManualDelivery` (487), `autocomplete` (394)
— fiecare testeaza UN singur serviciu/handler coeziv, fara seam de domeniu real (split-urile cu
seam au fost facute in #545/#546). **Prag:** se sparg cand depasesc ~550 de linii sau capata al
doilea domeniu, cu pattern-ul kit + fisiere pe scenarii.

## Gardurile text/regex pe sursa — EVALUAT (R6 #13): PASTRATE, cu politica de repointare

Evaluare onesta: gardurile pe sursa NU sunt accidente — fiecare pineaza o decizie ceruta explicit
de un review anterior (installers dinamici eliminati, compunere imutabila, factory-only, contracte
inchise), iar regulile repo-ului (no-comments, no-weakening) sunt deja pe AST, nu pe text. Costul
real observat in rundele 4-6: la refactoruri legitime gardurile cer repointare — dar exact asta e
functia lor: fac mutarea EXPLICITA in diff, nu tacuta. Politica (aplicata deja in practica):

- cand un refactor legitim atinge un gard, gardul se REPOINTEAZA in acelasi PR (protectia ramane,
  locatia se muta) — nu se sterge;
- cand un gard ancoreaza forma incidentala (nu o decizie), se inlocuieste cu un contract
  comportamental in PR-ul care il atinge, cu justificare per caz (regula 8: nimic sters fara
  confirmare);
- nu se face conversie in masa: gardurile care pineaza decizii de review raman sursa executabila
  a acelor decizii.

## Spargerea documentului Guild pe colectii — EVALUAT (R7 #7): AMANAT cu praguri

**Cererea din review.** Modelul Mongo `Guild` e „prea incarcat" — tine config, stare de abonare,
configurarea YouTube, backup-uri, audit si sugestii intr-un singur document (~58 de campuri
top-level in `infra/mongo/models.ts`). Chiar reviewerul precizeaza: „nu trebuie spart tot acum...
daca repo-ul creste" — deci cererea e explicit conditionata de crestere, nu un defect curent.

**Starea curenta (de ce e corect acum).** Partile cu crestere nemarginita au fost DEJA extrase in
colectii separate cu TTL/indexi proprii: `guildSeenDiscounts`, `guildSeenUpdates`,
`guildSeenYoutube` (istoricul „vazut", singurul volum care creste cu timpul), plus outbox-ul,
dead-letter-ele si snapshot-urile de fetch in colectiile lor. Ce ramane pe document e config +
stare marginita: listele limitate explicit (`priceAlerts` max 25/guild, `serverAuditLog`/`botAuditLog`
cu cap de intrari prin `buildServerAuditPush`, `configBackups` limitate) nu pot creste nemarginit.
Documentul unic cumpara exact proprietatea pe care se sprijina corectitudinea: scrierile
config + audit sunt atomice pe acelasi document (`$set`/`$pull` + `$push serverAuditLog` intr-un
singur `updateOne` — decizia R6 #7), fara tranzactii multi-document. Accesul e deja mediat de
repositories (R6 #6, plan in sectiunea dedicata), deci consumatorii nu depind de forma documentului.

**Praguri de declansare (oricare sustinut):**

- un camp-lista marginit isi pierde limita din cerinte de produs (ex. mai mult de ~100 de intrari
  reale per guild) — acel camp se extrage in colectia lui, pe modelul `guildSeen*`;
- dimensiunea medie a documentului Guild se apropie de ~1MB (masurabil cu `Object.bsonsize` /
  `collStats.avgObjSize`) sau apar avertismente Mongo de document mare;
- contentia pe scrieri concurente pe acelasi guild devine masurabila (conflicte/timeout-uri pe
  `updateOne` in logs/metrici), semn ca zonele independente au nevoie de documente separate.

**Constrangeri la implementare (cand se declanseaza).** Extractia se face per zona (YouTube,
records/backups, audit), prin repositories-urile existente (call-site-urile nu se schimba), iar
perechile care azi se scriu atomic pe acelasi document (config + audit) fie raman impreuna, fie
trec explicit pe compensare raportata onest (ca replay-cleanup-ul la reset) — nu se pierde tacut
atomicitatea.

## Planner/executor pentru serviciile de notificari — EVALUAT (R7 #5): primul pas executat pe calea de update, restul AMANAT

**Cererea din review.** Separarea planner (ce se trimite) / executor (trimiterea) / repository /
service in `updateNotificationService` si `discountNotificationService`.

**Ce era deja separat.** Deciziile pure majore traiau deja in module dedicate:
`pendingUpdatesQueue.ts` (`buildPendingUpdatesQueue` — dedupe + imbatranire + limita per joc),
`shared/discordEmbedChunks.ts` (`packEmbedsByBudget` — impartirea pe mesaje dupa buget),
`buildOptimizedGameList` (filtrarea jocurilor pe guild-uri), plus repositories pentru seen/dead-letter.

**Pas executat (R7 #5).** `features/notifications/updateNotificationPlanner.ts` extrage si restul
deciziilor pure din bucla de dispatch a update-urilor: `planRebaselineEntries` (derivarea seed-ului
la schimbarea de hash version), `takeNextPending` (selectia round-robin a urmatorului joc +
scoaterea din coada), `planPendingFailure` (decizia requeue-sub-prag / dead-letter-la-prag, care
era DUPLICATA pe cele doua cai de esec — embed esuat si send esuat) si `requeueFront`. Serviciul
delega — comportament identic, testele functionale existente trec neatinse; teste noi in
`updateNotificationPlanner.test.ts`.

**Pas executat si pe calea de reduceri (runda 10 — cererea explicita de a inchide amanarile).**
`features/notifications/discountNotificationPlanner.ts` extrage deciziile pure din
`discountNotificationService`: `buildDealsHashIndex` (indexul hash → deal cu dedupe si ordinea
primei aparitii), `planPendingDiscounts` (construirea listei pending: drop pe seen/max-attempts,
reimprospatarea snapshotului din feed, ciclurile de gratie cu attempts incrementat, intrarea
hash-urilor noi filtrate pana la limita) si `planDiscountFailure` (requeue-sub-prag pe copie /
dead-letter-la-prag). Serviciul delega — comportament identic, testele functionale existente
raman verzi; teste noi in `discountNotificationPlanner.test.ts`. Cache-ul WeakMap per referinta
de feed ramane in serviciu (e memoizare, nu decizie).

**Ce ramane amanat (si de ce).** Un „executor" complet separat ar rupe ordinea
corectitudine-critica claim-inainte-de-build/send cu rollback la esec: claim-ul atomic per item
e IMPLETIT intentionat cu deciziile (un plan intocmit inainte de claim ar putea trimite duplicat
intre instante). Asta nu e munca amanata, ci o granita de corectitudine.

## Review „arhitectura mare" (runda 9, itemele 3-10) — verdicte pe cod real

Reviewul descrie in buna parte un ALT bot: giveaways, FIFA market checks, DBD shrine, levels,
reaction-roles, welcome, mutes/timeouts programate, security scans, premium si limba serverului
NU exista ca functionalitati in acest repo. Verdictele de mai jos acopera doar ce se aplica
codului real (regula 20); functionalitatile inexistente sunt produs nou, nu refactor, si nu se
implementeaza speculativ. Itemele 1-2 ale reviewului nu au fost furnizate.

- **#3 Queue/job system — EXISTA.** „Sistemul propriu pe Mongo" sugerat de review e exact
  outbox-ul de notificari: coada persistata cu claim atomic per job (`findOneAndUpdate` +
  `lockedUntil`), retry cu backoff plafonat + jitter, dead-letter cu audit si replay, drain
  worker coordonat prin lock DB, exact-once intre instante (test pe Mongo real). „Retry la
  notificari esuate" = outbox; „verificari periodice" = ciclul cron cu lock `cron_main`;
  „player-count snapshots" = `PlayerCountSnapshotModel`, deja persistat. BullMQ + Redis:
  RESPINS — ar adauga o piesa de infrastructura pentru capabilitati deja acoperite; pragurile
  masurabile din sectiunea „Outbox: claim in batch" raman singurul declansator de schimbare.
- **#4 Worker separat — fundatia EXISTA, split-ul de proces AMANAT.** Munca periodica e deja
  coordonata prin lock-uri DB (`cron_main`, `outbox_drain`), corecta la N instante — poti rula
  AZI un al doilea proces care preia munca, fara modificari de cod (vezi sectiunea de sharding).
  Fetch-urile externe sunt I/O asincron cu buget de ciclu si shedding, deci nu blocheaza
  event-loop-ul de comenzi. Declansator pentru split-ul efectiv: latenta comenzilor masurabil
  degradata in timpul ciclurilor de fetch — masurabila direct cu metricile per comanda
  (`bot_command_duration_ms_total`, introduse la #6).
- **#5 Sharding — DEJA EVALUAT.** Reviewerul insusi: „nu e prioritar acum". Sectiunea
  „Sharding gateway Discord (la scara mare)" de mai sus are deja starea, calea si pragurile
  (2.500 guild-uri / backlog sustinut de trimitere). Nimic de schimbat.
- **#7 Logging centralizat — EXISTA; extensia AMANATA.** Logger-ul e structurat (nivel,
  context, mesaj, meta) cu `requestId` per interactiune (`requestContext.run` la
  `interactionCreate`); „cine a rulat comenzi admin" = `botAuditLog` (+ `/bot-log`), „cine a
  schimbat setari" = `serverAuditLog` scris atomic cu actiunea (+ `/server-log`); erorile de
  surse au context propriu si metrici per sursa. Reviewerul insusi: „ai inceput deja partea
  asta". Extensia (jurnal persistat pentru TOATE comenzile publice) ramane amanata:
  declansator — o nevoie reala de investigare pe care log-urile si auditul curent nu o acopera;
  costul e volum de scriere per interactiune publica.
- **#8 Module/plugin system — EXISTA ca arhitectura.** Pentru functionalitatile reale, repo-ul
  e deja organizat pe module cu exact fatetele cerute: `features/*` per domeniu (command-catalog
  pe 5 domenii, command-security, command-handlers cu youtube/ split pe use-case-uri,
  notifications, guild-config, admin-records), `sources/*` per sursa, fiecare cu contracte,
  repositories, teste si documentatie; descriptorii per comanda (R6 #4) leaga comanda de
  domeniu + acces + help cu fail-fast pe drift. Modulele din lista reviewului care nu exista
  (giveaways/fifa/dbd/levels/reaction-roles/welcome) sunt functionalitati noi de produs.
- **#9 Config per server — EXISTA.** Documentul Guild tine per server: module active
  (updates/reduceri/DLC/player-count/YouTube/future-release), canale si roluri, praguri
  (`minDiscountPercent`, `maxAbsolutePrice`, filtre), permisiuni (`adminCommandAccess` pe
  scope-uri canonice), mesaje custom (`youtubeMessageTemplate`), snooze-uri per comanda —
  cu valorile implicite intr-o singura sursa (`guildConfigDefaults`). „Limba serverului" si
  „premium status" nu exista ca concepte — decizii de produs, nu refactor.
- **#10 Deployment scalabil — AMANAT chiar de review** („mai tarziu, nu acum"). Exista deja:
  Docker + compose (bot + Mongo), configuratie de monitoring (Prometheus + alerte in repo),
  backup offline (`npm run db:export:guilds`) si `/backup` per server. Redis, dashboard web si
  reverse proxy se adauga cand apare nevoia lor reala, pe fundatia de lock-uri DB care permite
  deja multi-proces.
