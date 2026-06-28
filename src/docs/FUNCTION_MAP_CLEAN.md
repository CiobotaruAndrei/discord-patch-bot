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

### `src/app/lifecycle/events.ts`

- `registerDiscordEvents` cableaza handler-ele de client Discord (`ready`, `interactionCreate`, `guildCreate`, `error`/`warn`/`shardError`) prin dependency injection, fara import direct de `discord.js` (pentru testabilitate).
- Pe `ready` inregistreaza slash commands si porneste housekeeping/cron/outbox worker, fiecare cu try/catch + admin alert dedicat.
- `interactionCreate` ruleaza `commands.handleInteraction` intr-un `requestContext`; catch-ul top-level logheaza eroarea si apoi `replyInteractionError` trimite best-effort un raspuns ephemeral generic catre user (sare peste autocomplete/non-repliable, `followUp` pe interactiuni `deferred`/`replied`, altfel `reply`; esecul raspunsului e inghitit).
- `registerMongoEvents` cableaza log-urile de conexiune Mongo.

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
- Compunere **explicita si imutabila-din-exterior** (nu mai e installer dinamic pe context mutabil): `createMongoContext` nu mai foloseste `MongoInstaller[]` / `defaultInstallers` / bucla `for (install of installers)`, ci porneste de la o **copie proaspata** a singletonului `runtime` (`{ ...baseContext }`, deci nu mai muteaza modulul `runtime` partajat) si aplica installer-ele prin **apeluri explicite ordonate** (`attachLogging -> attachDomain -> attachEnv -> attachUtilities -> attachModels -> attachLocks -> attachMigrations -> attachSystemState -> attachGuildSettings -> attachAdminAlerts -> attachFetchSnapshots`, in ordinea dependentelor). Exportul singleton e `Object.freeze`-uit (`Object.freeze({ ...createMongoContext(), createMongoContext })`). Adaptoarele `attachX(target)` raman neschimbate (sunt folosite si direct de scripturi/teste de integrare: `check-db-indexes`, `acquireDbLock`, `guildSettingsCache` etc.). Gardat de `registryClosedContracts.test.ts` (fara `defaultInstallers`/bucla, copie proaspata, apeluri ordonate, export inghetat).
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

- Compune modulele de comenzi si interactiuni, importate **static** (importuri numite `attachX = require(...)`, nu `require`-uri inline).
- Compunere **explicita si imutabila** (fara installers dinamici): un `createAppServices` apeleaza factory-urile reale tipate (`createCommandCache`, `createCommandPresentation`, `createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) compunand fiecare zona prin **spread in obiecte noi** (`{ ...prev, ...createX(prev) }`), fara `Object.assign(base, ...)` pe un singur obiect mutat in loc; `createCommandRegistry` intoarce un registru **`Object.freeze`-uit**, apoi construieste o **lista tipata `CommandHandler[]`** din `attachX.buildCommandHandler(ctx)` rutata de `dispatchCommand` (loop `canHandle`/`handle`, fallback-ul mereu `canHandle: () => true` ultimul). Pre-check-ul admin (`requireGuildAdmin` prin `attachAdminCommandRouterGuard(ctx)`) ruleaza peste `commandSnoozeGuard`, care blocheaza comenzile puse temporar pe pauza inainte de `dispatchCommand`; nu mai e un lant de `attachX` care impacheteaza `handleInteraction`. `buildHelpEmbed` e cablat din `helpCommand.buildHelpEmbed`.
- Valideaza ca functiile adaugate de handler-e exista dupa compunere (fail-fast prin `requireInstalled`) si intoarce contractul inchis `RequiredCommandRegistry` (toate cheile `NonNullable`).
- `CommandRegistryContext` e un contract **inchis**: doar cheile declarate, cu semnaturile reale ale functiilor (ex. `checkForUpdates(client, games, shouldAbort?)`), fara `[key: string]: unknown` (gard in `registryClosedContracts.test.ts`, pe `ReturnType<createCommandRegistry>`).
- Boundary-ul de instalare dinamic (`installers: unknown[]` + `install(context as never)` + `LegacyInstallerTarget` + `CommandInstallerTarget` + `isCommandModuleInstaller`) a fost **eliminat**: compunerea e statica si verificata integral de `tsc`, fara niciun `as` pe boundary. **Cum a fost deblocata** estimarea anterioara (registrul ar trebui sa satisfaca simultan toate contextele locale, colapsand in `never`/`any`): reconciliind dep cu dep fiecare contract de handler la factory-ul real — stramtarea deps-urilor loose la semnaturi contravariante reale, segregare de interfata (contracte minimale ca `SteamPriceData`/`EmbeddableUpdate`, modele Mongo reduse la `OutboxRuntimeDeps`/`HistoryRepositoryDeps`) si unificarea tipurilor duplicate (`PendingUpdate`/`PendingDiscount` la alias-uri `types.*`). Garda din `registryClosedContracts.test.ts` pinuieste zero `installers`/`CommandInstallerTarget`/`isCommandModuleInstaller` si prezenta `requireInstalled`.
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

- Gestioneaza `/set games` si `/watchlist`.
- Normalizeaza si valideaza input-ul pentru jocuri urmarite.

### `src/features/command-handlers/snoozeInteractionHandler.ts`

- Gestioneaza `/snooze` si `/unsnooze`.
- Valideaza comanda aleasa prin catalogul `/help command` si salveaza pauzele temporare in setarile guild-ului.

### `src/features/command-security/commandSnoozeGuard.ts`

- Verifica fiecare comanda chat input inainte de dispatcher.
- Blocheaza comenzile cu snooze activ si lasa `/snooze`/`/unsnooze` disponibile permanent pentru administrare.

### `src/features/command-handlers/rolePingHandlers.ts`

- Gestioneaza `/set role`.

### `src/features/command-handlers/setInteractionHandler.ts`

- Gestioneaza subcomenzile directe `/set`.
- Trebuie sa aiba verificari runtime pentru administrator in operatiile sensibile.

### `src/features/command-handlers/configInteractionHandler.ts`

- Gestioneaza `/config`.
- Citeste setarile guild-ului si lista de jocuri configurate, apoi afiseaza intr-un embed ephemeral starea curenta a serverului: filtre reduceri, valuta, magazine, jocuri active, roluri, canale, canal administrativ si numarul alertelor de pret.

### `src/features/command-handlers/guildConfigurationAdminHandler.ts`

- Gestioneaza `/reset-config` si `/admin-alerts`.
- Resetarea cere `confirm:true` si revine la valorile implicite fara sa stearga istoricul; configurarea canalului administrativ verifica permisiunile de trimitere si embed inainte de persistenta.

### `src/features/command-handlers/priceAlertInteractionHandler.ts`

- Gestioneaza `/price-alert add`, `/price-alert remove` si `/price-alert list`.
- Persistenta este per joc+valuta, cu maximum 25 de reguli per server si stare de declansare/rearmare vizibila adminului.

### `src/features/command-handlers/latestInteractionHandler.ts`

- `/latest reduceri`: daca fetch-ul live pica, cade pe snapshot-ul persistat (`deals:<MONEDA>`, max 60 min vechime) inainte sa raporteze eroare — aceeasi plasa de siguranta ca dispatch-ul din cron. Itemii snapshot-ului trec prin type guard-ul real `validatePendingDiscountSnapshot` (fluxul e tipat `ValidatedDealInfo[]`, nu `unknown[]`; `savings` poate fi numar sau string numeric validat), fallback-ul NU se scrie in cache-ul live, fluxul ramane assignable la `DealInfo[]` pana la embed/paginare (`buildDealEmbed(deal: DealInfo)`, `handlePagination` generic), iar dupa un esec live exista backoff negativ de 60s: request-urile urmatoare merg direct pe snapshot (banner pastrat) fara sa loveasca sursele externe; dupa fereastra, fetch-ul live se reincearca.

- Gestioneaza `/latest`.
- Citeste ultimele update-uri sau reduceri cunoscute si raspunde cu embed-uri/paginare.

### `src/features/command-handlers/dlcInteractionHandler.ts`

- Gestioneaza `/dlc`.

### `src/features/command-handlers/statusInteractionHandler.ts`

- Gestioneaza `/status`.

### `src/features/command-handlers/sourcesStatusHandler.ts`

- Gestioneaza `/sources status`.
- Citeste snapshot-urile persistate pentru update-uri si reduceri, fara fetch live, si sumarizeaza starea surselor externe si varsta ultimei verificari cunoscute.

### `src/features/command-handlers/youtubeInteractionHandler.ts`

- Gestioneaza toate subcomenzile `/youtube`.
- Rezolva si salveaza canale YouTube publice, configureaza prima activare, canalul principal, rutele speciale, sablonul mesajului si filtrele de continut sau titlu.
- Expune afisarea manuala a videoclipurilor din ultima luna; implicit revendica (claim) videoclipurile cu destinatie pe care le afiseaza, deci o a doua rulare nu le mai reposteaza (optiunea `repeta:true` forteaza repostarea, ignorand claim-ul).
- Expune diagnoza prin `status`, `errors`, `permissions` si `clear-errors`; toate operatiile sunt protejate de admin guard si raspund ephemeral.

### `src/features/command-handlers/reportInteractionHandler.ts`

- Gestioneaza `/report submit`, `/report list` si `/report resolve`.
- `submit` ramane public pentru raportarea problemelor, iar `list`/`resolve` folosesc guard runtime de administrator fiindca top-level-ul `/report` trebuie sa ramana accesibil public pentru raportare.

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
- Conecteaza serviciile de update-uri, reduceri, YouTube si alerte de pret la runtime.
- `priceAlertService` reutilizeaza fetch-urile per valuta ale ciclului de reduceri.
- Compune `youtubeSource`, `youtubeRepository` si `youtubeNotificationService`, apoi expune functiile necesare comenzilor si cron-ului prin contractul inchis al registrului.
- Verificarea abonarii din `drainOutbox` traieste in `createIsStillSubscribed(GuildModel)` + `outboxSubscriptionFilter(job)` (fara `.catch(() => true)`): o eroare Mongo se **propaga** la `notificationOutbox.drainOutbox`, care e **fail-closed** (amana livrarea / dead-letter, nu livreaza orbeste intr-un canal posibil dezabonat). Filtrul cere pentru job-urile YouTube **automate** `youtubeNotificationsEnabled: true`, dar pentru job-urile **manuale** (`job.manual`, setat de `/youtube videos show` prin `enqueueOutbox`) verifica doar existenta destinatiei (canal principal sau ruta), ca afisarea manuala explicita sa supravietuiasca unui `/youtube notify off`. Acoperit de `outboxSubscriptionFilter.test.ts`.
- Trebuie sa ramana wiring, nu locul principal pentru logica de notificari.

### `src/features/notifications/priceAlertService.ts`

- Potriveste ofertele prin `appId` sau titlu/alias normalizat si alege cea mai ieftina oferta valida.
- Revendica atomic alerta in documentul guild-ului inainte de send, face rollback la esec si o rearmeaza numai dupa ce pretul revine peste prag.

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

### `src/features/youtube/youtubeSource.ts`

- Accepta link YouTube, handle `@nume` sau channel ID si rezolva identitatea canonica a canalului numai pe hosturi YouTube aprobate.
- Citeste feed-ul Atom oficial `feeds/videos.xml`, normalizeaza videoclipurile si obtine metadatele paginii necesare filtrelor Shorts, live, premiere si durata minima.
- Filtrul de durata este fail-closed cand durata nu poate fi confirmata.

### `src/features/youtube/youtubeRepository.ts`

- Seed-uieste baseline-ul in `guildSeenYoutube` si revendica atomic fiecare `videoId` prin indexul unic `{ guildId, channelId, videoId }`.
- Face rollback la esec de metadate/livrare, actualizeaza ultima verificare a canalului si pastreaza o lista plafonata de erori.
- Dezactiveaza notificarile cand canalul principal devine permanent invalid si elimina numai rutele speciale devenite invalide.

### `src/features/youtube/youtubeDeliveryPolicy.ts`

- Centralizeaza fereastra recenta de o luna, loturile de 5, pauza de 10 minute, sablonul implicit, variabilele permise, filtrul inclusiv de titlu si rezolvarea destinatiilor.
- Valideaza referintele canalelor Discord si pastreaza aceleasi reguli pentru livrarea automata si cea manuala.

### `src/features/youtube/youtubeNotificationService.ts`

- Grupeaza abonamentele tuturor guild-urilor dupa channel ID, astfel incat fiecare feed sa fie citit o singura data per ciclu.
- Aplica filtrele per-guild, sablonul si rutele speciale, revendica videoclipurile automate inainte de send si livreaza loturi de maximum 5 prin `outboundChannel`, outbox si history cu `kind: youtube`.
- Cron-ul (`processGuild`) verifica destinatia **per canal, inainte** de claim si de `prepareVideo` (fetch metadata): pentru un canal recent fara destinatie (fara canal principal si fara rute) videoclipul nu mai e revendicat-apoi-rollback-uit si nu se mai descarca metadata inutil — la fel ca afisarea manuala. `deliverPrepared` are o invarianta intarita: un item e marcat `successful` doar daca `totalDestinations > 0 && pendingDestinations === 0`, deci un item cu **0 destinatii** nu mai poate trece drept livrat (helper-ul refuza intern items fara destinatie, nu doar apelantii).
- Afisarea manuala (`/youtube videos show`) ruleaza prin `prepareManualVideos` (claim implicit la videoclipurile cu destinatie, fara `force`) + `deliverManualVideos` (`claimed=true` -> rollback la esec de livrare): primul lot direct/imediat, restul prin outbox-ul durabil cand e activat. Nu mai exista un wrapper `showYouTubeVideos` separat (era cale moarta, duplica logica handler-ului) — handler-ul cheama direct `prepareManualVideos`/`deliverManualVideos`.
- Cron-ul apeleaza `checkForYouTube` in paralel cu update-urile si reducerile; esecurile sunt izolate per feed/guild si devin vizibile in erorile YouTube si admin alerts.

## Domain, scrapers si sources

### `src/domain/deals/filtersCore.ts`

- Expune filtre pentru deal-uri, normalizatoare pentru pending queues si helper-e Map/Object.
- Foloseste `dealPassesFilters` din `src/native/fuzzy.ts` (TS-primary — calcul trivial, nativul pierde pe overhead-ul apelului, vezi `BENCHMARKS.md`).

### `src/sources/sourceRegistry.ts`

- Agrega sursele externe.
- Gestioneaza fallback-uri si erori de schema prin modulele din `src/sources/`.
- Sursele Steam/deals/updates sunt incluse in strict TypeScript si au teste directe pentru shape drift.
- Contractul registrului e **value-tipat din tipuri reale**: `SourceRegistryApi` e compus prin indexed access din `SteamSourceApi`/`DealsApi`/`UpdatesApi` (modulul partajat `sources/sourceApis.ts`) + tipurile-domeniu din `types.ts` (`DealInfo`, `NormalizedUpdate`, `PatchUpdate`) — fara `unknown` pe functiile de sursa; tipul e si exportat (`export type { SourceRegistryApi }`). Acoperit de `sourceRegistryTypedApi.test.ts`.
- `createSourceRegistry(): SourceRegistryApi` (fara parametri) compune **explicit, prin valorile returnate de factory-uri** (nu mutatie pe context): construieste un **context proaspat per registry** (`freshSourceContext()` = copie shallow a modulului `runtime`), apoi compune **imutabil** prin spread in obiecte noi (`{ ...base, ...attachHttpClient.buildFrom(base) }` -> `attachSteam.buildFrom(withHttp)` -> `attachUpdates.buildFrom(withSteam)` -> `attachDeals.buildFrom(withUpdates)`), in ordinea dependentelor, fara `Object.assign(context, ...)` in-place pe un context partajat; registrul returnat e `Object.freeze`-uit (nu mai exista `defaultInstallers: SourceInstaller[]` + bucla). Fiecare modul de sursa expune un `buildFrom(context)` care **intoarce** contributia (`createX`-ul sau), iar `attachX` deleaga la el (`Object.assign(target, buildXFrom(target))`), deci maparea de deps e intr-un singur loc, fara duplicare. Compunerea atinge copia proaspata, nu singletonul `runtime` partajat; exportul singleton `registry` ramane un wrapper peste un astfel de build, iar `buildSourceRegistry`/`requireSourceValue` extrag exportul **inchis** `SourceRegistryApi` (fail-fast pe cheie lipsa). Garda in `sourceRegistry.functional.test.ts` (registry-ul are toate exporturile + modulul `runtime` nu capata chei dupa un build) si `registryClosedContracts.test.ts` (fara `SourceInstaller`/`defaultInstallers`, compunere prin `build*From` ordonate).

### `src/sources/updates/` (split pe functionalitate)

- Fetch-uieste update-uri din Steam, RSS, HTML listing si surse custom; foloseste Rust pentru curatare text, scoring URL/listing si clasificare patch notes.
- `index.ts` — orchestrator: `createUpdates(deps)` compune sub-modulele, ruteaza sursele (`fetchGameUpdateForSource`), tine lantul de fallback (`fetchGameUpdate`), circuit breaker-ul (`executeFetchWithCircuitBreaker`), `getLatestForAllGames` si coalescing-ul `inflightAllGames`; cheia de coalescing se construieste din `buildCoalesceSignature` (semnatura completa a sursei, nu doar `key`); `attachUpdates` ramane adaptorul public.
- `updateHelpers.ts` — helpere pure si tipuri partajate: `absoluteUrl`, `isGoodSteamArticleUrl`, `extractDateScore`, `scoreCandidate`, `isLikelyPatchNote`, `sourceConcurrencyGroup`, `applyFallbackSource`.
- `coalesceSignature.ts` — `buildCoalesceSignature(games)` produce o semnatura deterministica, ordine-independenta, peste campurile care definesc sursa fiecarui joc (`key`, `type`, `url`, `appId`, `listingUrl`, `listingUrls`, `baseUrl`, `articleHrefRegex`, `requireKeywords`, `upCRD`, `fallbacks`), folosita ca cheie de coalescing in `getLatestForAllGames` ca un reload de config sa nu refoloseasca un promise vechi pe aceleasi chei dar sursa schimbata.
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
- `configInteractionHandler.functional.test.ts`;
- `sourcesStatusHandler.functional.test.ts`;
- `reportInteraction.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`.
- `sourceScraperShapeDrift.test.ts`.

Teste E2E:

- flux update: `/start updates` -> guild in Mongo -> cron gaseste update -> trimite embed -> marcheaza seen;
- flux reduceri: `/start reduceri` -> baseline reduceri -> cron -> deal embed -> `seenDiscounts`;
- flux YouTube: `/youtube subscribe` -> baseline `guildSeenYoutube` -> `/youtube notify on` -> cron grupeaza feed-urile -> filtre/metadate -> embed/outbox/history.

