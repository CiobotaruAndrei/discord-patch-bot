# Function map curat

Harta responsabilitatilor pentru structura curenta a proiectului. Foloseste acest fisier cand muti cod, redenumesti fisiere sau verifici daca documentatia mai corespunde cu repo-ul.

## App

### `src/app/main.ts`

- Porneste aplicatia.
- Incarca env/config.
- Conecteaza MongoDB.
- Creeaza clientul Discord.
- Instaleaza registrul de comenzi, sursele, job-urile si serverul health/metrics.
- Toate require-urile de module locale sunt tipate (`as typeof import(...)`, respectiv `SourceRegistryApi`), deci `satisfies AppRuntimeDeps` chiar verifica wiring-ul de boot — un export lipsa sau o semnatura gresita pica la compilare, nu la runtime (gard in `registryClosedContracts.test.ts`).

### `src/app/health/httpServer.ts`

- Expune `/healthz` si `/metrics`.
- Protejeaza metrics cu token optional si comparatie sigura.
- Nu trebuie sa contina logica de business pentru Discord sau scraping.

### `src/app/scheduler/cron.ts`

- Orchestreaza ciclurile de update-uri si reduceri.
- Gestioneaza lock distribuit, heartbeat, health window si abort.
- Nu trebuie sa contina logica de scraping sau de formatat embed-uri.

## Config si shared

### `src/shared/env.ts`

- Citeste si valideaza variabilele de mediu.
- Centralizeaza default-uri si limite numerice.

### `src/config/configLoader.ts`

- Incarca `config.json`.
- Expune lista de jocuri configurate.

### `src/config/configValidator.ts`

- Valideaza schema si cerintele de runtime pentru jocuri si surse.

### `src/shared/errors.ts`, `src/shared/logging.ts`, `src/shared/utilities.ts`

- Utilitare comune folosite de app, surse, comenzi si job-uri.

## Infra

### `src/infra/http/client.ts`

- Client HTTP cu retry, proxy templates, limite de dimensiune si validare URL externa.
- Valideaza hosturile externe si prin DNS/IP, ca request-urile sa nu ajunga in adrese locale sau private.
- Expune `cleanText`, `normalizeUpdate`, `stableUpdateId`, `dealHash` si helper-ele HTTP pe context.
- Foloseste wrapper-ele Rust din `src/native/fuzzy.ts` pentru hot-path-uri pure.

### `src/infra/mongo/models.ts`

- Defineste modelele Mongoose.

### `src/infra/mongo/mongoContext.ts`

- Construieste exporturile Mongo prin `createMongoContext`.
- Atasarea pe context ramane compatibila cu runtime-ul existent.
- Contractul e **value-tipat**: `MongoRuntimeContext` e un alias de obiect in care fiecare dintre cele 46 de chei are semnatura concreta — cele 13 modele sunt `Model<XDoc>` cu interfete de document dedicate in `infra/mongo/modelTypes.ts` (`GuildDoc`, `NotificationOutboxDoc`, `JobLockDoc`, `FetchSnapshotDoc` etc., derivate fidel din schemele Mongoose), functiile au parametri reali; tipurile-domeniu ramase `unknown` tin de modulele installer `export =`. Vezi `CONTEXT_REPO_CLEAN.md` (Pasul 7). Acoperit de `mongoContextTypedApi.test.ts`.

### `src/infra/mongo/locks.ts`

- Gestioneaza lock-ul distribuit pentru cron.
- Trebuie sa distinga intre lock pierdut si erori Mongo tranzitorii.

## Commands

### `src/features/command-definitions/slashCommandDefinitions.ts`

- Defineste slash commands pentru Discord.
- Logica e in factory-ul `createSlashCommandDefinitions(deps)`; installer-ul `attachSlashCommands(target)` doar deleaga (Object.assign). Scripturile (ex. staging smoke) pot construi definitiile direct prin factory, fara context de installer si fara cast — dep-ul `SlashCommandBuilder` e tipat cu builder-ul discord.js REAL (`typeof import("discord.js").SlashCommandBuilder`), nu cu un tip `Like` scris de mana.
- Seteaza permisiunile declarative pentru comenzile administrative.
- Trebuie sa ramana declarativ, fara logica de executie.

### `src/features/command-registry/commandRegistry.ts`

- Instaleaza modulele de comenzi si interactiuni, importate **static** (lista `defaultInstallers` e formata din importuri numite, nu `require`-uri inline).
- Leaga handler-ele la contextul runtime.
- Valideaza ca functiile necesare exista (fail-fast prin `requireRegistryFunction`).
- `CommandRegistryContext` e un contract **inchis**: doar cheile declarate, cu semnaturile reale ale functiilor (ex. `checkForUpdates(client, games, shouldAbort?)`), fara `[key: string]: unknown` (gard in `registryClosedContracts.test.ts`); cheile suplimentare schimbate intre installers raman responsabilitatea interfetelor per-modul.
- Installerele nu mai sunt apelate prin `install(context as never)` si nu mai folosesc `LegacyInstallerTarget = Record<string, unknown>`. Lista de installers ramane progresiva si dinamica, dar bucla accepta `CommandInstallerTarget = CommandRuntimeBootContext & CommandRegistryContext`, verifica runtime ca fiecare element este functie (`isCommandModuleInstaller`) si pastreaza validarea fail-fast a iesirilor prin `requireRegistryFunction`. **De ce nu un "context real" complet aici:** tipizarea compunerii cere ca registrul sa satisfaca simultan TOATE contextele declarate local de module; incercarea reproduce erori tsc pe chei produse de installers anteriori (`safeDefer`/`COLORS`/`checkUserCooldown`/`SEEN_PER_GAME_LIMIT` etc.) si conflicte structurale `logger`/`handleInteraction`. Fix-ul curent elimina `never` si numele legacy din registry; alternativa finala ramane DI per handler, fara registru progresiv.
- Ramane o zona de tranzitie pana cand toate dependintele sunt injectate explicit (factory-uri, fara registru).

### `src/features/command-runtime/commandRuntimeContext.ts`

- Construieste contextul comun folosit de wiring.
- Return type-ul e contractul **inchis** `CommandRuntimeContext` (bindings Discord & exporturile Mongo value-tipate & `SourceRegistryApi` & helperii de permisiuni), nu `Record<string, unknown>`; spread-urile vin din require-uri tipate.
- Este una dintre zonele principale de redus treptat.
- Scopul pe termen lung este sa livreze dependinte mici si tipate catre factory-uri, nu un obiect comun mare de context.

### `src/features/command-cache/commandCache.ts`

- Gestioneaza cache-uri runtime pentru updates, deals, DLC, single lookup si cooldown-uri user.
- `canSendEmbeds` cere toate cele trei permisiuni din `requiredNotifyPerms` (View Channel + Send Messages + Embed Links) — paritate garantata prin `canSendEmbedsPermissions.test.ts`.
- Expune `createCommandCache`, iar atasarea pe context ramane adapter de compatibilitate.
- Foloseste tipuri structurale pentru permisiuni/canale, nu tipuri wildcard nesigure.

### `src/features/command-presentation/commandPresentation.ts`

- Construieste embed-uri, paginare, select menus si raspunsuri user-facing.
- Contine helper-ul de fuzzy game lookup prin `findGameKeys` (TS-primary — Rust mai lent pe marshaling-ul NAPI, vezi `BENCHMARKS.md`; nativul ramane pentru benchmark/paritate).
- Expune `createCommandPresentation`, iar instalarea pe context este doar adapter de compatibilitate.
- Builder-ele Discord, collector-ul, interactiunile si raspunsurile HTTP sunt modelate local prin interfete mici.

## Command handlers

### `src/features/command-handlers/simpleCommandsHandler.ts`

- Gestioneaza `/ping` si `/games`.

### `src/features/command-handlers/helpInteractionHandler.ts`

- Gestioneaza `/help` si paginarea help-ului.

### `src/features/command-handlers/subscriptionNotificationHandlers.ts`

- Gestioneaza `/start` si `/stop` pentru update-uri si reduceri.
- Actualizeaza configuratia guild-ului si canalele de notificare.

### `src/features/command-handlers/gameFilterHandlers.ts`

- Gestioneaza `/set games`.
- Normalizeaza si valideaza input-ul pentru jocuri urmarite.

### `src/features/command-handlers/rolePingHandlers.ts`

- Gestioneaza `/set role`.

### `src/features/command-handlers/setInteractionHandler.ts`

- Gestioneaza subcomenzile directe `/set`.
- Trebuie sa aiba verificari runtime pentru administrator in operatiile sensibile.

### `src/features/command-handlers/latestInteractionHandler.ts`

- `/latest reduceri`: daca fetch-ul live pica, cade pe snapshot-ul persistat (`deals:<MONEDA>`, max 60 min vechime) inainte sa raporteze eroare — aceeasi plasa de siguranta ca dispatch-ul din cron. Itemii snapshot-ului trec prin type guard-ul real `validatePendingDiscountSnapshot` (fluxul e tipat `DealInfo[]`, nu `unknown[]`), fallback-ul NU se scrie in cache-ul live, fluxul e tipat `DealInfo[]` pana la embed/paginare (`buildDealEmbed(deal: DealInfo)`, `handlePagination` generic), iar dupa un esec live exista backoff negativ de 60s: request-urile urmatoare merg direct pe snapshot (banner pastrat) fara sa loveasca sursele externe; dupa fereastra, fetch-ul live se reincearca.

- Gestioneaza `/latest`.
- Citeste ultimele update-uri sau reduceri cunoscute si raspunde cu embed-uri/paginare.

### `src/features/command-handlers/dlcInteractionHandler.ts`

- Gestioneaza `/dlc`.

### `src/features/command-handlers/statusInteractionHandler.ts`

- Gestioneaza `/status`.

### `src/features/command-handlers/autocompleteInteractionHandler.ts`

- Gestioneaza autocomplete pentru optiunile slash commands.
- Delegheaza scoring-ul, sortarea si limitarea optiunilor catre `buildAutocompleteChoices` (TS-primary — masurat mai rapid decat nativul pe marshaling, vezi `BENCHMARKS.md`).
- Trebuie tinut separat de logica de executie a comenzilor.

### `src/features/command-handlers/fallbackInteractionHandler.ts`

- Fallback de final pentru interactiuni necunoscute sau neacoperite.
- Nu trebuie sa redezvolte logica de comenzi deja extrasa.

## Notifications

### `src/features/notifications/index.ts`

- Instaleaza job-urile de notificari.
- Conecteaza serviciile de update-uri si reduceri la runtime.
- Trebuie sa ramana wiring, nu locul principal pentru logica de notificari.

### `src/features/notifications/updateNotificationService.ts`

- Proceseaza update-urile noi.
- Verifica deduplicarea prin repository.
- Construieste si trimite embed-uri de update.
- Snapshot-ul de rezerva din event store trece prin `validateUpdateFetchSnapshot` (itemii fara `game.key`/`game.name`/`latest.id` valide sunt eliminati; daca nimic nu trece, fallback-ul e tratat ca inexistent, fara dispatch pe date neverificate); `checkForUpdates` e tipat `GameConfig[]` end-to-end (serviciu -> registry -> appRuntime -> cron).
- Esecul total e propagat, nu inghitit: fetch picat fara snapshot proaspat, toate guild-urile esuate la dispatch sau **toate jocurile cu `latest: null` si erori reale (non-abort)** -> `checkForUpdates` arunca, deci cron-ul marcheaza ciclul esuat (metrics + admin alert + health window); esecul partial ramane doar logat. Un rezultat integral `latest: null` nu se persista niciodata ca snapshot (ar deveni fallback fals-proaspat care mascheaza caderea).

### `src/features/notifications/discountNotificationService.ts`

- Proceseaza reducerile noi.
- Verifica deduplicarea prin repository.
- Foloseste `dealPassesFilters` pentru a respecta setarile guild-ului.
- Snapshot-ul de rezerva pentru reduceri trece prin `validatePendingDiscountSnapshot` (snapshot corupt = fallback inexistent, fara dispatch).
- Esecul total e propagat, nu inghitit: `checkForDiscounts` inspecteaza rezultatul `runConcurrent` si arunca daca toate guild-urile abonate au esuat (ex. fetch picat pentru toate monedele, fara snapshot proaspat); esecul partial ramane doar logat.

### `src/features/notifications/outboundChannel.ts`

- Rezolva canalul Discord in care se trimit notificarile.
- Izoleaza erorile de canal lipsa sau inaccesibil; `channelId` null/undefined sau client fara `user` (ne-ready) inseamna abort logat fara disable.
- Exporta `isSendableChannel` (type guard pe functia `send`), refolosit pe toate caile care trimit: calea directa (canal fara `send` = disable, nu cast care crapa la trimitere), `outboxDelivery` si onboarding-ul (`selectOnboardingChannel` sare canalele fara `send`).
- Clientul Discord e interfata minima exportata `NotificationDiscordClient` (`channels.fetch` + `user?.id`), folosita end-to-end: servicii -> registry (`checkForUpdates`/`checkForDiscounts`) -> `appRuntime`/cron (`DiscordClientLike` include `channels`), fara `client: unknown` pe lant (gard in `registryClosedContracts.test.ts`).
- Lantul de drain e tipat cu `OutboxDiscordClient` (= `NotificationDiscordClient & { isReady() }`), **importat** peste tot (`appRuntime`, `outboxWorker`, `/outbox drain-now`), nu repetat structural — tipul nu poate deriva in timp. `outboxDelivery`: client ne-ready = esec tranzitoriu, canal fara `send` (guard `isSendableChannel`) = esec permanent, fara cast-uri pe `channel.send`. `outboxWorker` sare ciclul si cand `client.user?.id` lipseste (nu doar pe `isReady()`), ca sa nu claim-uiasca joburi pe care livrarea le-ar esua tranzitoriu.
- Rezultatul e o uniune discriminata `{ abort: true; channel: null } | { abort: false; channel: OutboundChannel }` — dupa `if (abort) return;` serviciile au canal tipat end-to-end, fara cast-uri locale.
- `send(payload, meta)` accepta optional `meta.historyEntries` (intrarile pentru `/history`): pe calea directa (rate-limited) le scrie best-effort dupa send-ul real catre Discord; pe calea outbox le ataseaza pe job (`job.history`), iar scrierea se face in `notificationOutbox.drainOutbox` abia dupa livrarea reala din coada. Serviciile nu mai scriu istoric direct — altfel `/history` ar raporta ca "trimisa" o notificare doar enqueue-uita.

### `src/features/notifications/seenRepository.ts`

- Citeste si scrie elementele deja vazute.
- Acopera atat update-uri, cat si reduceri.
- Este modulul central pentru evitarea duplicatelor.

## Domain, scrapers si sources

### `src/domain/deals/filtersCore.ts`

- Expune filtre pentru deal-uri, normalizatoare pentru pending queues si helper-e Map/Object.
- Foloseste `dealPassesFilters` din `src/native/fuzzy.ts` (TS-primary — calcul trivial, nativul pierde pe overhead-ul apelului, vezi `BENCHMARKS.md`).

### `src/sources/sourceRegistry.ts`

- Agrega sursele externe.
- Gestioneaza fallback-uri si erori de schema prin modulele din `src/sources/`.
- Sursele Steam/deals/updates sunt incluse in strict TypeScript si au teste directe pentru shape drift.
- Contractul registrului e **value-tipat din tipuri reale**: `SourceRegistryApi` e compus prin indexed access din `SteamSourceApi`/`DealsApi`/`UpdatesApi` (modulul partajat `sources/sourceApis.ts`) + tipurile-domeniu din `types.ts` (`DealInfo`, `NormalizedUpdate`, `PatchUpdate`) — fara `unknown` pe functiile de sursa; tipul e si exportat (`export type { SourceRegistryApi }`). Acoperit de `sourceRegistryTypedApi.test.ts`.

### `src/sources/updates/` (split pe functionalitate)

- Fetch-uieste update-uri din Steam, RSS, HTML listing si surse custom; foloseste Rust pentru curatare text, scoring URL/listing si clasificare patch notes.
- `index.ts` — orchestrator: `createUpdates(deps)` compune sub-modulele, ruteaza sursele (`fetchGameUpdateForSource`), tine lantul de fallback (`fetchGameUpdate`), circuit breaker-ul (`executeFetchWithCircuitBreaker`), `getLatestForAllGames` si coalescing-ul `inflightAllGames`; `attachUpdates` ramane adaptorul public.
- `updateHelpers.ts` — helpere pure si tipuri partajate: `absoluteUrl`, `isGoodSteamArticleUrl`, `extractDateScore`, `scoreCandidate`, `isLikelyPatchNote`, `sourceConcurrencyGroup`, `applyFallbackSource`.
- `steamUpdates.ts` — `createSteamUpdates(deps)` -> `fetchSteamUpdate` (Steam news API, conditional GET).
- `listingUpdates.ts` — `createListingUpdates(deps)` -> `fetchListingBasedUpdate` (HTML listing, fanout marginit prin `runConcurrent`).
- `driverUpdates.ts` — `createDriverUpdates(deps)` -> `fetchAmdUpdate`, `fetchIntelUpdate`, `fetchNvidiaUpdate`; **Google News RSS e sursa primara** pentru toate trei (prin `conditionalGet` + parserul comun `parseDriverRssFeed`), iar paginile oficiale AMD/Intel raman fallback — paginile nu mai expun versiunile in HTML static (verificat live), deci ordinea veche ardea un fetch mort pe ciclu.
- `platformUpdates.ts` — `createPlatformUpdates(deps)` -> `fetchFortniteUpdate`, `fetchMinecraftUpdate`, `fetchRobloxUpdate`, `fetchRssUpdate`; sursele `minecraft` si `roblox` incearca mirror-uri oficiale in ordine (`piston-meta` -> `launchermeta`; `clientsettings` -> `clientsettingscdn`) prin `conditionalGetFromMirrors`, ca un singur host cazut sa nu mai omoare sursa.

### `src/sources/deals/` (split pe functionalitate)

- Fetch-uieste reduceri Steam/Epic, deduplica si sorteaza ofertele; foloseste `normalizeTitleForDedupe` si `dealHash` din Rust/N-API prin context.
- `index.ts` — orchestrator: `createDeals(deps)` compune sub-factory-urile, `_fetchDealsImpl` fetch-uieste Steam si Epic **in paralel** (`Promise.all` — fiecare sursa isi prinde intern erorile si intoarce lista partiala, deci una cazuta nu o blocheaza pe cealalta) si trece totul prin `dedupeAndRankDeals`, iar `fetchDeals` tine coalescing-ul `inflightDeals` in closure; `attachDeals` ramane adaptorul public.
- `dealHelpers.ts` — tipuri partajate (`HttpReq`, `TrackInflight`, `WithInflightTimeout`, `DealCurrencyCode`) + helperul pur `dedupeAndRankDeals` (dedupe pe titlu normalizat, sortare dupa `popularityScore`, taiere la `MAX_DEALS`).
- `steamDeals.ts` — `createSteamDeals(deps)` -> `fetchSteamReviewData` + `fetchSteamSpecials` (featured categories + review-uri in batch-uri cu pauza, scor hibrid savings/quality/bonus).
- `epicDeals.ts` — `createEpicDeals(deps)` -> `fetchEpicSpecials` (GraphQL searchStore, mapare pret/promotii/imagini).
- `dealEnrichment.ts` — `createDealEnrichment(deps)` -> `enrichDealData` + `enrichCacheGet`/`enrichCacheSet`/`cleanEnrichedCache`/`getEnrichedCacheSize`; cache-ul LRU `enrichedCache` ramane la nivel de modul (cache pur de date, cheie `dealId:currency`), iar `activeEnrichments` traieste in closure-ul instantei.

### `src/sources/steam/index.ts`

- Cauta jocuri Steam, alege cel mai bun match si extrage detalii de pret.
- Foloseste Levenshtein din Rust/N-API.

## Native Rust/N-API

### `src/native/core/src/lib.rs`

- Crate-ul pur `discord_patch_bot_logic` (rlib, fara napi): fuzzy matching, Levenshtein, normalizare text, hash-uri, autocomplete scoring, scoring listing-uri si filtrare deal-uri.
- Toate testele unitare Rust traiesc aici si ruleaza fara build-ul N-API (`cargo test -p discord_patch_bot_logic`).
- Nu trebuie sa depinda de Discord, Mongo, HTTP, env sau filesystem.

### `src/native/src/lib.rs`

- Wrapper-ul cdylib N-API (`discord_patch_bot_core`): doar structuri `#[napi(object)]` si functii `#[napi]` care deleaga la `discord_patch_bot_logic`.
- Numele cdylib-ului ramane neschimbat, deci fisierul `.node`, `index.js` si `index.d.ts` generate de `napi build` raman identice.

### `src/native/fuzzy.ts`

- Incarca addon-ul `.node` si expune fallback TypeScript.
- Trebuie sa pastreze contract identic intre Rust si TypeScript.
- Logheaza explicit cand addon-ul nativ lipseste in productie.

## Test map

Teste de baza:

- env/config;
- registry si slash commands;
- parsere si filtre;
- circuit breaker si cooldown-uri;
- health/metrics;
- deduplicare;
- native Rust/fallback contracts.

Teste functionale curente:

- `simpleCommandsHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`.
- `sourceScraperShapeDrift.test.ts`.

Teste E2E:

- flux update: `/start updates` -> guild in Mongo -> cron gaseste update -> trimite embed -> marcheaza seen;
- flux reduceri: `/start reduceri` -> baseline reduceri -> cron -> deal embed -> `seenDiscounts`.

