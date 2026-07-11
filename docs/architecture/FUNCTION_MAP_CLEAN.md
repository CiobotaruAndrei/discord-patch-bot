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

### `src/app/scheduler/cron.ts` (+ `cronScheduleConfig.ts`, `cronHealthWindow.ts`, `cronJobRunner.ts`)

- `cron.ts` e controller-ul: `createCronController` compune modulele si tine orchestrarea ciclului (`runCronCycle`), lock-ul distribuit + heartbeat-ul (cu invariantele de concurenta pe `currentCronToken`, vezi `CONTEXT_REPO_CLEAN.md`), programarea (`scheduleNextCron`) si abort-ul (`stop`). Nu trebuie sa contina logica de scraping sau de formatat embed-uri.
- `cronScheduleConfig.ts` — `resolveCronScheduleConfig(config, env, parseEnvNumber, logger)` calculeaza intervalul (validat pe 10/15/30/60 min), `lockTtlMs`, `heartbeatIntervalMs`, jitter-ul si bugetul de ciclu; `computeCronDelay` (interval + jitter marginit) traieste tot aici si e re-exportat de `cron.ts`.
- `cronHealthWindow.ts` — `createCronHealthWindow(env, logger)`: fereastra de succes/durata (`recordHealth`), decizia de backoff cand rata scade sub prag (`shouldSkipForGlobalHealth`, un skip programat o singura data) si `getHealthSnapshot`.
- `cronJobRunner.ts` — `buildCronCycleJobs` (lista de joburi ale ciclului: updates, reduceri — omise cand `shedDiscounts`, YouTube, player-count optional) + `runCronJobs` (runner generic `Promise.allSettled` care intoarce doar esecurile cu labelul lor). Gardat de `cronModules.test.ts`.

### `src/app/lifecycle/bootPhases.ts`

- Fazele de boot ca functii numite, compuse in ordine de `createBootSequence` din `appRuntime.ts`: `runDatabaseStartupPhase` (connect cu retry + confirmarea ready + migrari cu politica fail-fast/continue-on-error si admin alert), `runCacheHydrationPhase` (hidratarea din snapshot, esec doar cu WARN), `runHttpStartupPhase` (handler-ul de eroare legat inainte de listen + alerta `http:listen`), `runDiscordStartupPhase` (login). Fiecare faza primeste dependinte minime tipizate, deci e testabila izolat.

### `src/app/lifecycle/events.ts`

- `registerDiscordEvents` cableaza handler-ele de client Discord (`ready`, `interactionCreate`, `guildCreate`, `error`/`warn`/`shardError`) prin dependency injection, fara import direct de `discord.js` (pentru testabilitate).
- Pe `ready` inregistreaza slash commands si porneste housekeeping/cron/outbox worker, fiecare cu try/catch + admin alert dedicat.
- `interactionCreate` ruleaza `commands.handleInteraction` intr-un `requestContext`; catch-ul top-level logheaza eroarea si apoi `replyInteractionError` trimite best-effort un raspuns ephemeral generic catre user (sare peste autocomplete/non-repliable, `followUp` pe interactiuni `deferred`/`replied`, altfel `reply`; esecul raspunsului e inghitit).
- `registerMongoEvents` cableaza log-urile de conexiune Mongo.
- Contractele Discord ale stratului lifecycle sunt tipuri dedicate in `lifecycleContracts.ts` (`LifecycleDiscordInteraction`, `LifecycleDiscordChannel`, `LifecycleDiscordGuild`, `LifecycleEventClient`), nu `unknown`: listener-ele `interactionCreate`/`guildCreate` primesc tipurile structurale, `replyInteractionError` nu mai are cast, `handleGuildCreate` primeste guild-ul direct (fara `as Parameters<...>`), iar `commands.handleInteraction`/`canSendEmbeds` din deps sunt declarate pe aceste tipuri (implementarea din registry, care accepta `unknown`, le satisface prin contravarianta). `appRuntime.DiscordClientLike` extinde `LifecycleEventClient` si tipizeaza `channels.fetch` la `LifecycleDiscordChannel | null`. Gardat de `lifecycleContracts.test.ts` (checks compile-time ca parametrii nu mai sunt `unknown` + un client discord.js-like satisface structural contractul).

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

### `src/infra/http/` (client compus din module pe responsabilitati)

- `client.ts` e orchestratorul `safeHttpRequest`: agentii keep-alive cu DNS lookup sigur, `httpReq` (retry cu backoff/Retry-After prin `retryPolicy`, limite de dimensiune, User-Agent rotativ, abort signal) si expunerea constantelor de env pe context. Valideaza hosturile externe si prin DNS/IP (`ssrfGuard`), inclusiv redirecturile.
- Responsabilitatile sunt module dedicate compuse de client: `ssrfGuard` (validare URL/DNS/IP), `retryPolicy` (clasificare esecuri + backoff), `proxyTemplates` + `proxyClient` (fallback prin proxy-uri, extractie allorigins, epuizare raportata), `conditionalCache` (ETag/Last-Modified), `httpMetrics`, `inflightTracker` (timeout pe promisiuni blocate + curatarea map-urilor de deduplicare), `contentNormalization` (`cleanText`, `truncate`, `normalizeUpdate`, `stableUpdateId`, `normalizeDealState`, `dealHash`, `safeCheerioLoad` cu taiere la limita de bytes fara sa rupa utf8).
- `contentNormalization` foloseste wrapper-ele Rust din `src/native/fuzzy.ts` pentru hot-path-urile pure; contractul intors de `buildHttpClientFrom` e neschimbat.
- Boundary-ul e complet tipat: `buildHttpClientFrom(deps: HttpClientDeps)` primeste exact dependintele declarate (fara `& Record<string, unknown>`), iar modulul exporta un obiect (`buildFrom` + helper-ele SSRF/proxy/retry), nu un installer `attachHttpClient(target)` cu `Object.assign` — compunerea se face doar prin valoarea returnata (`{ ...base, ...client.buildFrom(base) }` in `sourceRegistry`).

### `src/infra/mongo/models.ts` (+ scheme pe domenii)

- `models.ts` e asamblorul: construieste `guildSchema` din sub-schemele de domeniu, inregistreaza toate modelele si intoarce acelasi contract (`buildMongoModelsFrom` + adapterul `attachMongoModels`).
- Sub-schemele guild traiesc in module pe domenii: `guildNotificationSchemas.ts` (pendingUpdate/pendingDiscount/priceAlert), `guildYoutubeSchemas.ts` (youtubeChannel/youtubeChannelRoute/youtubeLastError), `guildAdminRecordSchemas.ts` (watchlistGameSuggestion/futureReleaseGame/adminCommandAccess). Auditul admin nu mai sta pe documentul guild: `auditLogSchemas.ts` defineste `guildAuditLogSchema` pentru colectia dedicata `guildAuditLogs` (`{ guildId, kind: "bot"|"server", userId, command, action, result, details, at }`), cu index `{ guildId, kind, at: -1 }` pentru listari si TTL pe `at` din `GUILD_AUDIT_LOG_TTL_DAYS` (implicit 180 de zile) in locul vechiului cap de 100 de intrari per array; migrarea de boot #8 muta intrarile existente (upsert idempotent pe continut) si sterge campurile vechi `botAuditLog`/`serverAuditLog`. Nici backup-urile de configuratie nu mai stau pe documentul guild: `configBackupSchemas.ts` defineste `guildConfigBackupSchema` pentru colectia `guildConfigBackups` (`{ guildId, name, createdBy, createdAt, snapshot }`), cu index unic `{ guildId, name }` (un backup per nume per guild) si index `{ guildId, createdAt: -1 }` pentru listare/evictie; migrarea de boot #9 muta backup-urile existente (upsert idempotent pe cheia naturala) si sterge campul vechi `configBackups`. La fel si sugestiile de comenzi: `suggestedCommandSchemas.ts` defineste `guildSuggestedCommandSchema` pentru colectia `guildSuggestedCommands` (`{ guildId, commandName, description, createdBy, createdAt }`), cu index unic `{ guildId, commandName }` (o sugestie per nume per guild) si index `{ guildId, createdAt: -1 }` pentru listare/evictie (cap 100); migrarea de boot #10 muta sugestiile existente si sterge campul vechi `suggestedCommands`. Si jurnalul de erori YouTube: `youtubeErrorLogSchemas.ts` defineste `guildYoutubeErrorSchema` pentru colectia `guildYoutubeErrors` (`{ guildId, channelId, channelName, message, at }`), cu index `{ guildId, at: -1 }` pentru listare/numarare/evictie (cap 20 per guild); migrarea de boot #11 muta erorile existente si sterge campul vechi `youtubeErrors`. Si auditul dead-letter: `deadLetterLogSchemas.ts` defineste `guildDeadLetterSchema` pentru colectia `guildDeadLetters` (`{ guildId, kind, itemId, title, channelId, dedupeKey, reason, attempts, failedAt }`), cu index `{ guildId, failedAt: -1 }` pentru listare/numarare/evictie (cap 50 per guild); migrarea de boot #12 muta intrarile existente si sterge campul vechi `notificationDeadLetter`.
- Schemele de colectii sunt grupate tot pe domenii: `operationalSchemas.ts` (circuitBreaker/system/jobLock/adminAlertCooldown/fetchSnapshot/playerCountSnapshot/feedbackReport), `seenSchemas.ts` (guildSeenDiscount/guildSeenUpdate/guildSeenYoutube, cu indexurile unice), `outboxSchemas.ts` (notificationOutbox/outboxSent/notificationHistory/deadLetterReplay, cu indexurile si TTL-urile lor). Indexurile raman definite langa schema lor; `check-db-indexes` ramane verde.
- Tipurile de documente sunt sparte pe agregate (review impact-mare #11): `guildSettingsDocTypes.ts` (`GuildDoc` + sub-intrarile lui), `operationalDocTypes.ts` (circuitBreaker/system/jobLock/adminAlertCooldown/fetchSnapshot/playerCountSnapshot/feedbackReport), `adminRecordDocTypes.ts` (audit/configBackup/suggestedCommand), `guildLogDocTypes.ts` (youtubeError/deadLetter), `seenDocTypes.ts` si `outboxDocTypes.ts`; `modelTypes.ts` ramane barrel de re-export ca importurile existente sa nu se schimbe. `GuildDoc` este aliniat 1:1 cu campurile top-level din `guildSchema` — paritatea e gardata de `mongoSchemaDomains.test.ts` (extractie de campuri din ambele directii, acum pe `guildSettingsDocTypes.ts`); tipurile moarte ale array-urilor mutate in colectii la review-ul #6 (`DeadLetterEntry`, `ConfigBackupRecord`, `BotAuditLogEntry`, `ServerAuditLogEntry`, `SuggestedCommandEntry` din vechiul `modelTypes`) au fost sterse.

### `src/infra/mongo/mongoContext.ts`

- Construieste exporturile Mongo prin `createMongoContext`.
- Compunere prin **factory-return imutabil**, exact ca `sourceRegistry` (nu mai e installer pe context mutabil): fiecare modul installer expune un `buildFrom(context)` care **intoarce** contributia (in loc de `Object.assign(target, ...)`), iar `attachX(target)` deleaga la el (`Object.assign(target, buildXFrom(target))`). `createMongoContext` porneste de la o **copie proaspata** a singletonului `runtime` si compune prin **spread in obiecte noi** (`{ ...prev, ...attachX.buildFrom(prev) }`) in ordinea dependentelor (`logging -> domain -> env -> utilities -> models -> locks -> migrations -> systemState -> guildSettings -> adminAlerts -> fetchSnapshots`), fara mutatie pe un context partajat in timpul compunerii. Ordinea garanteaza ca fiecare `buildFrom` citeste doar campuri ale straturilor anterioare (fara forward-reference). Exportul singleton e `Object.freeze`-uit (`Object.freeze({ ...createMongoContext(), createMongoContext })`). Adaptoarele `attachX(target)` raman (sunt folosite si direct de scripturi/teste de integrare: `check-db-indexes`, `acquireDbLock`, `guildSettingsCache` etc.). Gardat de `registryClosedContracts.test.ts` (fara `defaultInstallers`/bucla, compunere prin `build*From` ordonat, fara `attachX(context)`, export inghetat).
- Contractul e **value-tipat**: `MongoRuntimeContext` e un alias de obiect in care fiecare dintre cele 46 de chei are semnatura concreta — cele 13 modele sunt `Model<XDoc>` cu interfete de document dedicate in `infra/mongo/modelTypes.ts` (`GuildDoc`, `NotificationOutboxDoc`, `JobLockDoc`, `FetchSnapshotDoc` etc., derivate fidel din schemele Mongoose), functiile au parametri reali; tipurile-domeniu ramase `unknown` tin de modulele installer `export =`. Vezi `CONTEXT_REPO_CLEAN.md` (Pasul 7). Acoperit de `mongoContextTypedApi.test.ts`.

### `src/infra/mongo/locks.ts`

- Gestioneaza lock-ul distribuit pentru cron.
- Trebuie sa distinga intre lock pierdut si erori Mongo tranzitorii.

## Commands

### `src/features/command-definitions/slashCommandDefinitions.ts`

- Defineste slash commands pentru Discord.
- Logica e in factory-ul `createSlashCommandDefinitions(deps)`; installer-ul `attachSlashCommands(target)` doar deleaga (Object.assign). Scripturile (ex. staging smoke) pot construi definitiile direct prin factory, fara context de installer si fara cast — dep-ul `SlashCommandBuilder` e tipat cu builder-ul discord.js REAL (`typeof import("discord.js").SlashCommandBuilder`), nu cu un tip `Like` scris de mana.
- Builder-ele comenzilor stau in module pe domenii, compuse de factory in `buildSlashCommandDefinitions()`: `coreCommandDefinitions` (ping/games/help/suggest-command/watchlist-game/history/report/health), `adminCommandDefinitions` (add/remove/delete/config/backup/bot-log/server-log/reset-config/admin-alerts/admin-command-access/maintenance/snooze/unsnooze/set/watchlist/sources), `notificationCommandDefinitions` (price-alert/future-release/start/stop), `dealsCommandDefinitions` (price-check/deal-score/best/ending), `gameInfoCommandDefinitions` (review-trend/crossplay/platforms/co-op/system/game-size/player-count/top/latest/dlc/status), `youtubeCommandDefinitions` (/youtube), `outboxCommandDefinitions` (/outbox). Fiecare modul primeste `SlashDefinitionTools` (builder + permisiuni + CURRENCY_CHOICES din `slashDefinitionTools.ts`) si intoarce builder-ele domeniului; gardat de `slashDefinitionsDomainSplit.test.ts` (fiecare domeniu contribuie, nume unice intre domenii, compozitia = reuniunea modulelor, dm_permission false pastrat la admin).
- Seteaza permisiunile declarative pentru comenzile administrative.
- Trebuie sa ramana declarativ, fara logica de executie.

### `src/features/command-registry/commandRegistry.ts`

- Compune modulele de comenzi si interactiuni, importate **static** (importuri numite `attachX = require(...)`, nu `require`-uri inline).
- Compunere **explicita si imutabila** (fara installers dinamici): un `createAppServices` apeleaza factory-urile reale tipate (`createCommandCache`, `createCommandPresentation`, `createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) compunand fiecare zona prin **spread in obiecte noi** (`{ ...prev, ...createX(prev) }`), fara `Object.assign(base, ...)` pe un singur obiect mutat in loc; `createCommandRegistry` intoarce un registru **`Object.freeze`-uit**, apoi construieste o **lista tipata `CommandHandler[]`** din `attachX.buildCommandHandler(ctx)` rutata de `dispatchCommand` (loop `canHandle`/`handle`, fallback-ul mereu `canHandle: () => true` ultimul). Pre-check-ul admin (`requireGuildAdmin` prin `attachAdminCommandRouterGuard(ctx)`) ruleaza peste `commandSnoozeGuard`, accepta implicit `Administrator`, accepta roluri doar din `adminCommandAccess` configurat de owner, apoi codul global de acces introdus prin modal ephemeral si scrie audit in colectia `guildAuditLogs`; pentru comenzi sensibile poate cere user ID din `BOT_SENSITIVE_USER_IDS`; nu mai e un lant de `attachX` care impacheteaza `handleInteraction`, iar registrul nu mai scrie NIMIC inapoi in context dupa compunere: `handleInteraction`/`buildHelpEmbed` sunt functii locale intoarse direct in obiectul inghetat (fara `ctx.handleInteraction = ...`, fara garda `requireInstalled`), contextele celor 32 de handler-e nu mai cara reziduul `handleInteraction?:` din era installer-elor (gardat de `registryClosedContracts.test.ts`), iar `adminCommandRouterGuard` exporta un obiect inghetat de functii (installer-ul legacy apelabil, care muta target-ul prin `Object.assign`, a fost sters). `buildHelpEmbed` e cablat din `helpCommand.buildHelpEmbed`.
- Valideaza ca functiile adaugate de handler-e exista dupa compunere (fail-fast prin `requireInstalled`) si intoarce contractul inchis `RequiredCommandRegistry` (toate cheile `NonNullable`).
- `CommandRegistryContext` e un contract **inchis**: doar cheile declarate, cu semnaturile reale ale functiilor (ex. `checkForUpdates(client, games, shouldAbort?)`), fara `[key: string]: unknown` (gard in `registryClosedContracts.test.ts`, pe `ReturnType<createCommandRegistry>`).
- Boundary-ul de instalare dinamic (`installers: unknown[]` + `install(context as never)` + `LegacyInstallerTarget` + `CommandInstallerTarget` + `isCommandModuleInstaller`) a fost **eliminat**: compunerea e statica si verificata integral de `tsc`, fara niciun `as` pe boundary. **Cum a fost deblocata** estimarea anterioara (registrul ar trebui sa satisfaca simultan toate contextele locale, colapsand in `never`/`any`): reconciliind dep cu dep fiecare contract de handler la factory-ul real — stramtarea deps-urilor loose la semnaturi contravariante reale, segregare de interfata (contracte minimale ca `SteamPriceData`/`EmbeddableUpdate`, modele Mongo reduse la `OutboxRuntimeDeps`/`HistoryRepositoryDeps`) si unificarea tipurilor duplicate (`PendingUpdate`/`PendingDiscount` la alias-uri `types.*`). Garda din `registryClosedContracts.test.ts` pinuieste zero `installers`/`CommandInstallerTarget`/`isCommandModuleInstaller` si prezenta `requireInstalled`.
- Ramane o zona de tranzitie pana cand toate dependintele sunt injectate explicit (factory-uri, fara registru).

### `src/features/command-registry/commandMatch.ts`

- `CommandDescriptor` declarativ (`{ commandNames, requireGuild?, group?, subcommand? }`) + `matchesCommand(interaction, descriptor)` — matcher pur care inlocuieste predicatele `canHandle` duplicate din handler-e (verifica chat-input, guild optional, numele comenzii, si optional grupul/subcomanda; throw-safe la `getSubcommand`).
- Adoptat de **toate cele 16 handler-e cu forma comuna** (`config`/`deal-score`/`dlc`/`price-check`/`report`/`help`/`latest`/`future-release`/`outbox`/`history`/`maintenance` nume simplu, `bot-log`+`server-log` & `reset-config`+`admin-alerts` multi-nume, `health` `requireGuild:false`, `set role` grup, `sources status` subcomanda): `is*Command` deleaga la `matchesCommand`. Handler-ele cu logica genuin custom (`backup`, `set` cu excluderi, `price-alert`, `game-info`, `simple-commands`, `watchlist`/`set games`) raman pe predicate proprii. Testat in `commandMatch.test.ts`.

### `src/features/command-runtime/commandRuntimeContext.ts`

- Construieste contextul comun folosit de wiring.
- Return type-ul e contractul **inchis** `CommandRuntimeContext` (bindings Discord & exporturile Mongo value-tipate & `SourceRegistryApi` & helperii de permisiuni), nu `Record<string, unknown>`; spread-urile vin din require-uri tipate.
- Este una dintre zonele principale de redus treptat.
- Scopul pe termen lung este sa livreze dependinte mici si tipate catre factory-uri, nu un obiect comun mare de context.

### `src/features/command-cache/commandCache.ts` (+ module pe responsabilitati)

- `commandCache.ts` e orchestratorul: `createCommandCache(deps)` compune cele cinci module de responsabilitate si intoarce acelasi API plat ca inainte de split (limitele + functiile de cache + cooldown + permisiuni + formatare erori + utilitarele marunte `smoothTime`/`makeActivationId`/`sleepIfPositive`); atasarea pe context ramane adapter de compatibilitate.
- Responsabilitatile sunt module dedicate: `runtimeLimits.ts` (limitele mapate 1:1 din `RuntimeEnv` + `COLORS`/`OP_UPDATE_OPTS` inghetate), `commandCaches.ts` (cache-urile LRU+TTL pentru updates/deals/single/DLC, `cacheGetLRU`/`evictLRU`/`cacheSetLRU` pure exportate, `cleanCache`/`getCacheSizes` cu delegare la cooldown-urile injectate), `userCooldowns.ts` (fereastra per user+comanda, curatare periodica cu prag si hard-max), `channelPermissionChecks.ts` (`isTextChannelLikeValue`/`computeMissingChannelPerms`/`formatMissingChannelPerms` pure + `createChannelPermissionChecks` cu `canSendEmbeds`), `userErrorFormatting.ts` (`formatUserError` cu logging conditionat).
- `canSendEmbeds` cere toate cele trei permisiuni din `requiredNotifyPerms` (View Channel + Send Messages + Embed Links) — paritate garantata prin `canSendEmbedsPermissions.test.ts`; modulele sunt acoperite de `commandCacheModules.test.ts`.
- Foloseste tipuri structurale pentru permisiuni/canale, nu tipuri wildcard nesigure.

### `src/features/command-presentation/commandPresentation.ts` (+ module pe responsabilitati)

- Construieste embed-uri, paginare si raspunsuri user-facing; `commandPresentation.ts` e orchestratorul care compune sub-factory-urile si intoarce acelasi contract public (`createCommandPresentation` cu cele 14 functii; instalarea pe context ramane doar adapter de compatibilitate).
- Responsabilitatile sunt module dedicate: `interactionReplyHelpers.ts` (`enforceCooldown`/`startCommandLog`/`safeDefer`/`safeEdit` pe contractul minimal `DeferEditInteraction`), `notificationEmbeds.ts` (`buildUpdateEmbed`/`buildDealEmbed`, pure — gardate de `notificationEmbeds.test.ts`), `paginationControls.ts` (sesiune + butoane + `handlePagination` cu collector), `gameLookupCache.ts` (fuzzy game lookup prin `findGameKeys`, TS-primary — Rust mai lent pe marshaling-ul NAPI, vezi `BENCHMARKS.md` — cu cache LRU per instanta si guard pe lista de jocuri), `gameStatusEmbeds.ts` (`fetchGameStatus` + `buildSteamPriceEmbed`).
- Tipurile partajate (embed/butoane/interactiuni minimale) stau in `presentationContracts.ts`; builder-ele Discord, collector-ul si raspunsurile HTTP raman modelate local prin interfete mici.

### `src/features/admin-records/` (repositories dedicate)

- `configBackupRepository.ts` — backup-urile de configuratie, pe colectia dedicata `guildConfigBackups` prin `GuildConfigBackupModel`: `saveConfigBackup` face upsert pe cheia naturala `(guildId, name)` si evacueaza cele mai vechi backup-uri peste capul de 20 per guild (inlocuieste vechiul pipeline `$filter`+`$slice` de pe array-ul din documentul guild), `findConfigBackup`/`listConfigBackups`/`findNewestConfigBackup` citesc sortat descrescator dupa `createdAt`, iar `deleteConfigBackup(WithAudit)` sterge pe cheia naturala (audit doar dupa un delete real). Restore-ul (`loadConfigBackup(WithAudit)`) ramane un `updateOne` pe documentul guild. Clasificarea campurilor ramane aici: TOATE campurile din `guildSchema` sunt in `GUILD_SETTINGS_FIELD_ROLES` (`config` / `security` / `operational`), iar `CONFIG_BACKUP_KEYS` e derivat din clasificare (nu lista manuala); un test de sincronizare bidirectional cu schema reala forteaza clasificarea oricarui camp nou. Campurile `security` (`adminCommandAccess*`) sunt deliberat excluse: `/backup load` e admin-level si nu are voie sa rescrie reguli owner-only.
- `auditLogRepository.ts` — auditul comenzilor bot si al schimbarilor de server, pe colectia dedicata `guildAuditLogs` prin `GuildAuditLogModel`: `recordBotAuditEntry`/`recordServerAuditEntry` fac `create` cu `kind: "bot"`/`"server"`, iar listarile (`recent` + interval `[start, end)` cu offset) merg pe `find(...).sort({ at: -1 }).skip().limit().lean()`. Retentia e TTL-ul `GUILD_AUDIT_LOG_TTL_DAYS`, nu un `$slice` la scriere; scrierile combinate de tip regula+audit dintr-un singur `updateOne` au fost sparte in scrierea principala urmata de audit (auditul se scrie doar dupa succesul scrierii principale).
- `suggestedCommandsRepository.ts` — sugestiile de comenzi, pe colectia dedicata `guildSuggestedCommands` prin `GuildSuggestedCommandModel`: `saveSuggestedCommand` face upsert cu `$setOnInsert` pe cheia naturala `(guildId, commandName)` (un nume deja propus nu se dubleaza si nu e rescris; `added` vine din `upsertedCount`) si evacueaza cele mai vechi sugestii peste capul de 100 per guild; `listSuggestedCommands` citeste sortat descrescator dupa `createdAt`, iar `deleteSuggestedCommand` sterge pe cheia naturala cu nume normalizat (audit doar dupa un delete real).
- `watchlistGameSuggestionsRepository.ts` — propunerile de jocuri pentru watchlist: acelasi model atomic de dedupe.
- `futureReleaseGamesRepository.ts` — jocurile future-release: pipeline atomic care refuza depasirea limitei de 20, listare alfabetica si stergere normalizata.
- Functiile de listare lasa handler-ele sa decida formatul Discord.

## Command handlers

### `src/features/command-handlers/simpleCommandsHandler.ts`

- Gestioneaza `/ping` si `/games`.

### `src/features/command-handlers/helpInteractionHandler.ts`

- Gestioneaza `/help` si paginarea help-ului.

### `src/features/command-handlers/subscriptionNotificationHandlers.ts` (+ `startStopCommandFactory.ts`, familii per modul, `subscriptionCommandContracts.ts`)

- Gestioneaza `/start` si `/stop` pentru update-uri, reduceri, canalul DLC si player-count; orchestratorul ramane cu export public identic (installer + `createSubscriptionInteractionHandlers` + `buildCommandHandler`).
- `startStopCommandFactory.ts` (`createStartStopHandlers`) tine framework-ul comun: defer, verificarea permisiunilor de canal la start, rutarea pe subcomanda catre familia potrivita, mesajul de subcomanda necunoscuta, `try/catch`-ul de baza de date la stop.
- Fiecare familie e un modul cu `start`/`stop` dedicat: `updatesSubscriptionFamily.ts` si `discountsSubscriptionFamily.ts` raman stratul de prezentare (mesajele Discord + baseline seed-ul per modul: fetch updates/deals cu valuta si cache-ul de deals) si DELEGA tranzactia de stare la `features/notifications/subscriptionService.ts`; `dlcSubscriptionFamily.ts` (configurarea canalului DLC), `playerCountSubscriptionFamily.ts` (adaugare/scoatere joc din lista de player-count, cu `findConfiguredGame`/`normalizeGameKey`).
- `features/notifications/subscriptionService.ts` (`createSubscriptionService`) tine operatiile atomice de abonare pe documentul Guild, fara nicio dependinta de Discord: `startUpdates`/`startDiscounts` (activare cu `activationId` + `seedBaseline` injectat + finalize conditionat de activation-id, cu rezultat tipat `activated`/`superseded`/`baseline-failed`), `stopUpdates`/`stopDiscounts` (dezactivare cu golirea pending-ului si `$unset` pe activation-id) si `rollbackActivation` (revenire conditionata de activation-id + `lastError` persistat + WARN + invalidare cache, best-effort). Cele doua module sunt specificatii de campuri peste acelasi nucleu generic. Acoperit de `subscriptionService.test.ts`.
- `subscriptionCommandContracts.ts` tine tipurile partajate (`SubscriptionInteraction`, `SubscriptionInteractionDeps`, `SubscriptionFamily`, `SubscriptionContext`), inclusiv `safeDefer` tipat canonic. Gardat de `startStopCommandFactory.test.ts` (rutarea pe subcomanda, subcomanda necunoscuta, refuz la lipsa permisiunilor, `try/catch`-ul de stop) si de testele functionale existente de subscriptie (neatinse).

### `src/features/command-handlers/gameFilterHandlers.ts`

- Gestioneaza `/set games` si `/watchlist`.
- Normalizeaza si valideaza input-ul pentru jocuri urmarite.

### `src/features/command-handlers/gameInfoInteractionHandler.ts` (+ `gameInfoLookupService.ts`, `gameInfoEmbeds.ts` = barrel peste `gameInfoEmbedPrimitives`/`dealsEmbeds`/`comparisonEmbeds`/`steamMetadataEmbeds`/`playerCountEmbeds`)

- Gestioneaza comenzile de informatii joc: `/best deals under`, `/ending deals`, `/review-trend`, `/crossplay`, `/platforms`, `/co-op`, `/system requirements`, `/game-size`, `/player-count`, `/top active games`; topul active games este calculat global din jocurile cunoscute de bot cu Steam appId, nu din watchlist-ul serverului.
- Handler-ul e orchestratorul (cooldown + defer + rutarea pe subcomanda + catch cu raspuns ephemeral); achizitia de date sta in `gameInfoLookupService.ts` (`createGameInfoLookupService`: `resolveCurrency` explicit -> guild -> default, `loadDeals` cu cache, `resolveSteam` cautare + best match + detalii, `readFreshSnapshots` cu prag de prospetime si fallback pe fetch live la eroare), iar formatarea sta in module de embed pe domenii, re-exportate de barrel-ul `gameInfoEmbeds.ts`: `gameInfoEmbedPrimitives.ts` (tipuri + culori/limite + helper-e pure partajate: normalizeText, numericPrice, parseDateMs, requirementValue, extractInstallSize, hasCategory, platformList), `dealsEmbeds.ts` (best/ending deals + scor/discount/linie + findExternalStores), `comparisonEmbeds.ts` (review-trend/crossplay/platforms/co-op), `steamMetadataEmbeds.ts` (system requirements + game-size), `playerCountEmbeds.ts` (player-count + top active + selectTopActiveGames). Toate builder-ele raman pure, fara dependinte de Discord sau Mongo; barrel-ul pastreaza import-urile handler-ului neschimbate. Gardat de `gameInfoEmbedsModules.test.ts` (re-exporturile sunt aceleasi referinte + comportamentul fiecarui domeniu).
- Contractul public al modulului e neschimbat (`createGameInfoInteractionHandler`, `buildCommandHandler`, builder-ele re-exportate). Acoperit de `gameInfoInteractionHandler.functional.test.ts` si `gameInfoLookupService.test.ts`.

### `src/features/command-handlers/snoozeInteractionHandler.ts`

- Gestioneaza `/snooze` si `/unsnooze`.
- Valideaza comanda aleasa prin catalogul `/help command` si salveaza pauzele temporare in setarile guild-ului.

### `src/features/command-security/commandSnoozeGuard.ts`

- Verifica fiecare comanda chat input inainte de dispatcher.
- Blocheaza comenzile cu snooze activ si lasa `/snooze`/`/unsnooze` disponibile permanent pentru administrare.

### `src/features/command-security/adminPermissionGuard.ts`

- Verifica accesul runtime la comenzile admin.
- Accepta implicit permisiunea Discord `Administrator`; rolurile sunt acceptate doar daca ownerul serverului seteaza explicit o regula dedicata in `adminCommandAccessByCommand` sau fallback-ul global `adminCommandAccess` prin `/set admin-command-access`; codul global de acces este fallback-ul runtime cerut prin modal ephemeral cand utilizatorul nu trece verificarile configurate. Scope-urile `start`/`stop` sunt normalizate pe acelasi modul, astfel incat o regula pentru `/start player-count` se aplica si la `/stop player-count`.
- Refuzul vizibil este `Access denied.`.

### `src/features/command-catalog/commandCatalog.ts`

- Sursa unica pentru faptele per comanda: manifestul de acces (`COMMAND_ACCESS_MANIFEST`: tier public/admin, `discordAdminPermissions`, exceptii de subcomenzi publice/admin-runtime, owner-only, cai sensibile) + intrarile de help per cale (`COMMAND_CATALOG_HELP`: descriere, exemplu, note, aliases, flag `ephemeral` doar pentru caile publice ephemeral).
- Etichetele de permisiuni din help NU mai sunt scrise de mana: `permissionsLabelFor(path, ephemeral?)` le deriveaza din regulile de acces (Public / Public, Ephemeral / Admin, Ephemeral / Admin runtime, Ephemeral / owner-only), deci un fapt de acces e definit O SINGURA DATA si eticheta nu poate drifta.
- `commandAccessManifest.ts` (command-security) si `commandHelpCatalog.ts` (command-help) sunt derivari subtiri din catalog, cu API-ul lor public neschimbat; toate testele de sincronizare existente (manifest ⇔ slash defs ⇔ help ⇔ docs) raman active peste datele derivate. Gardat de `commandCatalog.test.ts` (derivarile de eticheta, formele cunoscute, flag-ul ephemeral doar pe cai publice, acoperirea bidirectionala manifest ⇔ help).

### `src/features/command-security/adminCommandRouterGuard.ts` (+ `adminAccessResolver.ts`, `globalAccessCodeModal.ts`, `adminAuditRecorder.ts`, `adminGuardContracts.ts`)

- `adminCommandRouterGuard.ts` e middleware-ul: intercepteaza top-level comenzile admin inainte de dispatcher, le blocheaza in DM, autorizeaza (owner-only -> Discord admin -> rol configurat pe scope -> modal cu cod global) si scrie auditul in jurul handler-ului urmator; exportul public (installer + toate staticele) e neschimbat.
- `adminAccessResolver.ts` tine clasificarea cailor si citirile: subcomanda/grupul/numele de audit, `isAdminProtectedCommand`/`isSensitiveAdminCommand`/`isOwnerOnlyAdminAccessCommand` (peste manifest), `resolveOwnerId`/`isGuildOwner`, allowlist-ul `BOT_SENSITIVE_USER_IDS`, guard-ul de conexiune Mongo (`canUseGuildModel`) si incarcarea configului de acces pe scope. Acoperit de `adminAccessResolver.test.ts`.
- `globalAccessCodeModal.ts` tine modalul de cod global + lockout-ul: fereastra de esecuri, blocarea la 5 esecuri/10 min pentru 15 min, alerta `security:access-code`, verificarea prin `globalAccessCode` si re-legarea interactiunii pe modal submit.
- `adminAuditRecorder.ts` scrie auditul de acces (`Access granted.` / `Access denied.` / `Command error.` / `Error.`) in colectia `guildAuditLogs` prin `recordBotAuditEntry` pe `GuildAuditLogModel`, best-effort.
- `adminGuardContracts.ts` tine tipurile partajate (interactiunea minimala de guard, modelul de acces, contextul, contractul `adminPermissionGuard`).
- `adminScopeIds.ts` e sursa canonica a scope-urilor de acces admin, GENERATA din catalogul de comenzi (nu strings scrise de mana): tipul brand `AdminScopeId`, `ADMIN_SCOPE_IDS` (global + forma canonica a fiecarei comenzi admin configurabile, cu `start:`/`stop:` unificate in `start-stop:`), `parseAdminScopeId` (canonicalizeaza si valideaza input-ul; singurul loc care construieste ID-uri) si `isAdminScopeId` (type guard strict). `/set admin-command-access` valideaza prin parse, iar `saveAdminAccessRule` accepta doar `AdminScopeId` — un scope inventat nu mai poate fi persistat, garantat la compilare. `adminSettableScopeCatalog.ts` ramane prezentarea (autocomplete choices) si delega validarea. Acoperit de `adminScopeIds.test.ts`.
- Gestioneaza fallback-ul prin cod global de acces configurat in `BOT_GLOBAL_ACCESS_CODE_HASH` sau, doar local/secret manager, `BOT_GLOBAL_ACCESS_CODE`; pentru comenzi sensibile, daca `BOT_SENSITIVE_USER_IDS` este setat, cere si user ID autorizat.

### `src/features/command-security/runtimeAdminAudit.ts`

- `requireGuildAdminAudited`: pentru subcomenzile admin-runtime din comenzi **publice** (`/report list|resolve`, `/suggest-command list|delete`, `/watchlist-game delete`) care nu trec prin guard-ul central; ruleaza `requireGuildAdmin` si, daca respinge, scrie `Access denied.` in colectia `guildAuditLogs` (refuzul e auditat, nu doar succesul).

### `src/features/command-handlers/adminCommandAccessViews.ts`

- Functii pure de prezentare/normalizare folosite de `adminCommandAccessHandler.ts`: `formatCurrentAccess`/`formatAccessList`/`formatScopedAccess` (mesajele de listare, inclusiv avertismentul de reguli in conflict si fallback-ul global), plus `labelMode`/`normalizeMode` si tipurile `AdminAccessMode`/`GuildAdminAccessDoc`.
- Fara acces la Mongo/Discord/DI; depinde doar de helper-ele de scope din `command-security/adminCommandAccessScope`. Testabil izolat.

### `src/features/command-handlers/rolePingHandlers.ts`

- Gestioneaza `/set role`.

### `src/features/command-handlers/setInteractionHandler.ts`

- Gestioneaza subcomenzile directe `/set` (defer, aplicare update via `applyGuildConfigUpdate`, avertisment Read Message History, tratarea erorilor).
- Deleaga construirea planului de update (validare + `updateDoc`/mesaj per subcomanda) catre `setUpdatePlan.ts`; `buildSetUpdatePlan` ramane re-exportat de aici pentru compatibilitate.
- Trebuie sa aiba verificari runtime pentru administrator in operatiile sensibile.

### `src/features/command-handlers/setUpdatePlan.ts`

- Functie pura `buildSetUpdatePlan(sub, interaction, supportedCurrencies)` care mapeaza fiecare subcomanda `/set` (mode/mindiscount/maxprice/free/paid/outbox-recovery-verify/currency/stores/update-template/discount-template) la un `SetUpdatePlan` (`updateDoc`, `confirmMsg`, `isFilterChange`, `earlyReply`).
- Fara acces la Mongo/Discord si fara DI — depinde doar de `normalizeNotificationTemplate`; testabil izolat.

### `src/features/command-handlers/configInteractionHandler.ts`

- Gestioneaza `/config`.
- Citeste setarile guild-ului si lista de jocuri configurate, apoi afiseaza intr-un embed ephemeral starea curenta a serverului; construirea embed-ului e delegata modulului pur `configView.ts` (`buildConfigEmbed`, re-exportat pentru compatibilitate).

### `src/features/command-handlers/configView.ts`

- Functie pura `buildConfigEmbed(settings, games, defaultCurrency)` care compune embed-ul `/config` (filtre reduceri, valuta, magazine, jocuri active, roluri, canale, alerte de pret, liste propuse, YouTube) + helperele `onOff`/`formatChannel`/`formatRole`/`formatAdminAlertChannel`/`formatGames`/`formatStores` si tipul `ConfigEmbed`.
- Fara acces la Mongo/Discord/DI; depinde doar de `clampJoinedList`. Testabil izolat.

### `src/features/command-handlers/guildConfigurationAdminHandler.ts`

- Gestioneaza `/reset-config` si `/admin-alerts`.
- Resetarea cere `confirm:true` si revine la valorile implicite fara sa stearga istoricul; configurarea canalului administrativ verifica permisiunile de trimitere si embed inainte de persistenta.

### `src/features/command-handlers/priceAlertInteractionHandler.ts`

- Gestioneaza `/add price-alert`, `/remove price-alert` si `/price-alert list`.
- Persistenta este per joc+valuta, cu maximum 25 de reguli per server si stare de declansare/rearmare vizibila adminului.

### `src/features/command-handlers/backupInteractionHandler.ts`

- Gestioneaza `/add backup`, `/backup list`, `/backup preview`, `/backup load` si `/backup delete`.
- `load` si `delete` cer `confirm:true`; `preview` afiseaza setarile si ID-urile de canale/roluri care vor fi restaurate.
- Backup-urile traiesc in colectia dedicata `guildConfigBackups` (prin `GuildConfigBackupModel` + `configBackupRepository`); doar restore-ul mai scrie pe documentul guild.
- Scrie audit server pentru backup-uri salvate, incarcate sau sterse.
- Delegheaza randarea textelor (`renderBackupList`/`renderBackupPreview`) modulului pur `backupViews.ts`; `renderBackupPreview` ramane re-exportat pentru compatibilitate.

### `src/features/command-handlers/backupViews.ts`

- Functii pure de randare pentru `/backup`: `renderBackupList` (lista backup-urilor cu autor + data) si `renderBackupPreview` (diff-ul fata de configuratia curenta: setari care se restaureaza, setari care se sterg, canale/roluri referite).
- Fara acces la Mongo/Discord/DI; depinde doar de `clampJoinedList` si `CONFIG_BACKUP_KEYS`. Testabil izolat.

### `src/features/command-handlers/auditLogInteractionHandler.ts`

- Gestioneaza `/bot-log recent/older` si `/server-log recent/older`.
- Citeste intrarile sortate descrescator din colectia `guildAuditLogs` (prin `auditLogRepository` + `GuildAuditLogModel`), le poate filtra pe zi/saptamana/luna si le limiteaza la 1-25 intrari pentru raspunsuri Discord sigure.

### `src/features/command-handlers/priceCheckInteractionHandler.ts`

- Gestioneaza `/price-check`.
- Cauta jocul pe Steam, afiseaza pretul Steam in embed verde si compara cu ofertele similare din feed-ul de reduceri deja folosit de bot.
- Delegheaza comparatia de titluri si construirea embed-ului (`titlesComparable`/`findComparableDeals`/`buildPriceCheckEmbed`) modulului pur `priceCheckComparison.ts`; le re-exporta pentru compatibilitate.

### `src/features/command-handlers/priceCheckComparison.ts`

- Functii pure de comparatie si prezentare pentru `/price-check`: `titlesComparable` (potrivire de titluri prin token overlap + Jaccard), `findComparableDeals` (filtreaza ofertele externe comparabile, exclude Steam, potrivire sigura pe appId), `buildPriceCheckEmbed` (embed-ul de comparatie) + helperele `normalizeTitle`/`numericPrice`/`steamPriceLine`/`titleTokens` si tipul `SteamPriceData`.
- Fara acces la retea/DI; `formatPrice` primit ca parametru. Testabil izolat.

### `src/features/command-handlers/dealScoreInteractionHandler.ts`

- Gestioneaza `/deal-score`.
- Calculeaza un scor 1-10 pentru o oferta activa pe baza reducerii, pretului, semnalelor de calitate/popularitate si magazinului.

### `src/features/command-handlers/suggestCommandInteractionHandler.ts`

- Gestioneaza `/add suggestion`, `/suggest-command list` si `/suggest-command delete`.
- `/add suggestion` ramane public pentru sugestii de useri, iar `list`/`delete` cer admin la runtime pentru administrarea propunerilor; fiindca top-level-ul e public, `delete` scrie explicit in colectia `guildAuditLogs` (`/bot-log`), nu trece prin auditul central al guard-ului.
- Sugestiile traiesc in colectia dedicata `guildSuggestedCommands` (prin `GuildSuggestedCommandModel` + `suggestedCommandsRepository`); handler-ul nu mai atinge documentul guild si nu mai are nevoie de `getGuildSettings`/`invalidateGuildCache`.
- Anti-spam pe comanda publica `/add suggestion`: cooldown per user (`enforceCooldown`) + dedupe atomic in `saveSuggestedCommand` (upsert `$setOnInsert` pe indexul unic, care nu dubleaza un nume normalizat deja propus), cu raspuns „e deja in lista" cand exista.

### `src/features/command-handlers/watchlistGameSuggestionHandler.ts`

- Gestioneaza `/watchlist-game add`, `/watchlist-game list` si `/watchlist-game delete`.
- Permite userilor sa propuna jocuri noi pentru bot, iar adminilor sa stearga propunerile nepotrivite; `delete` (admin runtime pe comanda publica) scrie in colectia `guildAuditLogs`.
- Anti-spam pe `/watchlist-game add`: cooldown per user + dedupe atomic in `saveWatchlistGameSuggestion`, la fel ca la sugestiile de comenzi.

### `src/features/command-handlers/futureReleaseInteractionHandler.ts`

- Gestioneaza `/future-release add`, `/future-release list`, `/future-release delete`, `/future-release start` si `/future-release stop`.
- Pastreaza lista de maxim 20 jocuri viitoare si canalul configurat pentru notificarile future-release. `add` salveaza printr-un singur pipeline atomic (`saveFutureReleaseGame` cu `findOneAndUpdate` + `$cond`) care refuza al 21-lea joc in loc sa evacueze tacut; `list` afiseaza clar cand modulul e activ fara canal salvat, fara `<#undefined>`.

### `src/features/command-handlers/maintenanceInteractionHandler.ts`

- Gestioneaza `/maintenance`.
- Afiseaza sumar operational pentru surse cu erori, outbox, dead-letter, backup, canale lipsa si module de notificare active.

### `src/features/command-handlers/latestInteractionHandler.ts`

- `/latest reduceri`: daca fetch-ul live pica, cade pe snapshot-ul persistat (`deals:<MONEDA>`, max 60 min vechime) inainte sa raporteze eroare — aceeasi plasa de siguranta ca dispatch-ul din cron. Itemii snapshot-ului trec prin type guard-ul real `validatePendingDiscountSnapshot` (fluxul e tipat `ValidatedDealInfo[]`, nu `unknown[]`; `savings` poate fi numar sau string numeric validat), fallback-ul NU se scrie in cache-ul live, fluxul ramane assignable la `DealInfo[]` pana la embed/paginare (`buildDealEmbed(deal: DealInfo)`, `handlePagination` generic), iar dupa un esec live exista backoff negativ de 60s: request-urile urmatoare merg direct pe snapshot (banner pastrat) fara sa loveasca sursele externe; dupa fereastra, fetch-ul live se reincearca.

- Gestioneaza `/latest`.
- Citeste ultimele update-uri sau reduceri cunoscute si raspunde cu embed-uri/paginare.

### `src/features/command-handlers/dlcInteractionHandler.ts`

- Gestioneaza `/dlc`.
- Delegheaza parsarea paginii Steam (`dlcPageHasAgeGate`/`parseDlcRows`/`dlcPageLooksLikeStorePage`) modulului pur `dlcSteamPage.ts`.

### `src/features/command-handlers/dlcSteamPage.ts`

- Functii pure de parsare a paginii de magazin Steam pe baza unui `CheerioAPI` deja incarcat: `dlcPageHasAgeGate` (detecteaza age-gate-ul), `parseDlcRows` (extrage numele + pretul DLC-urilor, deduplicat dupa `data-ds-appid`, cu `Pret indisponibil` la pret lipsa) si `dlcPageLooksLikeStorePage` (distinge schema drift de o pagina fara DLC-uri).
- Fara acces la retea/DI; testabil izolat cu cheerio real pe HTML-fixtura.

### `src/features/command-handlers/statusInteractionHandler.ts`

- Gestioneaza `/status`.

### `src/features/command-handlers/sourcesStatusHandler.ts`

- Gestioneaza `/sources status`.
- Citeste snapshot-urile persistate pentru update-uri si reduceri, fara fetch live, si delegheaza construirea embed-ului de status modulului pur `sourcesStatusView.ts`.

### `src/features/command-handlers/sourcesStatusView.ts`

- Functii pure care transforma snapshot-urile persistate + sumarul de sanatate al surselor intr-un embed de status: `buildSourcesStatusEmbed` (linii per store/feed, culoare pe severitate, varsta ultimului fetch, blocul de sanatate circuit-breaker) + helperele `findUpdateEntry`/`lineForUpdateGame`/`lineForDealStore`/`formatAge`/`newestFetchDate`/`renderLine`/`renderHealthLines` si tipurile `LoadedFetchSnapshot`/`LoadedDealsFetchSnapshot`/`SourcesStatusEmbed`.
- Fara acces la Mongo/Discord/DI. Testabil izolat.

### `src/features/youtube/youtubeNotificationService.ts` + sub-serviciile lui

- Serviciul principal e orchestratorul fluxului automat (`checkForYouTube`/`processGuild`) si manual (`prepareManualVideos`/`deliverManualVideos`); sub-serviciile compuse, fiecare cu dependinte minime: `youtubeFeedLoader` (feed-uri unice per canal cu concurenta marginita, erorile devin `FeedResult.error`), `youtubeMetadataResolver` (cache memoizat de metadata per videoId), `youtubeFilterEngine` (`prepareVideo`: metadata + filtrele guild-ului + filtrul de titlu), `youtubeDeliveryPlanner` (pur: `buildYouTubeEmbed`, `sortedVideos`, `packYouTubeDeliveries` cu limite de caractere/batch), `youtubeDeliveryExecutor` (`deliverPrepared`: grupare pe destinatii, resolve outbound cu disable/remove-route la eroare permanenta, chunking + stagger prin outbox), `youtubeRollbackPolicy` (rollback-ul claim-urilor prin `rollbackOrReport`, cu raportare la esec).
- Semantica claim/rollback: videoclipurile vechi sau cu notificarile oprite (dupa prima activare) sunt doar claim-uite; cele livrabile sunt claim-uite inainte de preparare, iar esecul de preparare/livrare/abort face rollback (raportat) ca sa poata fi reluate.

### `src/features/command-handlers/youtubeInteractionHandler.ts` + `youtube/` (module dedicate)

- Fisierul principal e doar **router**: dispatch pe grup/subcomanda catre modulele dedicate din `command-handlers/youtube/` si pastreaza instalarea/catch-ul de erori; API-ul public (install + `createYouTubeInteractionHandler` + `buildCommandHandler` + formatters) e neschimbat.
- `youtubeSubscriptionCommands.ts` — `subscribe`/`unsubscribe`; `youtubeNotifyCommands.ts` — `notify`, `message-template`, `channel-route`; `youtubeFilterCommands.ts` — `filter`, `title-filter`; `youtubeManualVideoCommands.ts` — `videos show` (claim + loturi + nota outbox); `youtubeDiagnosticsCommands.ts` — `errors`, `permissions`; `youtubePresentation.ts` — formatters puri (list/status/rute/filtre).
- **Zero pipeline-uri Mongo in handlere**: toate scrierile stau in `features/youtube/youtubeGuildConfigRepository.ts` — `subscribe` (limita 25 canale), `channel-route add` (limita de fanout) si `title-filter add` salveaza prin pipeline-uri atomice (`findOneAndUpdate` cu `$cond`) care refuza depasirea sub comenzi concurente; handler-ele fac doar input, autorizare, apel de repository si raspuns. `unsubscribe` invalideaza cache-ul imediat dupa `$pull`, iar curatarea colectiei seen e best-effort. `subscribe` e o **unitate logica cu rollback**: baseline-ul seen (videoclipurile vechi marcate vazute) se scrie inainte de salvarea abonarii, iar daca salvarea esueaza sau limita e ocupata concurent, baseline-ul abia scris e curatat best-effort (`removeSeenChannel`), ca sa nu ramana intrari seen orfane pentru un canal neabonat.
- Configurarea unui canal Discord (`notify channel`, `add channel-route`) cere `View Channel` + `Send Messages` + `Embed Links`; `permissions` afiseaza fiecare permisiune per canal.
- Afisarea manuala a videoclipurilor din ultima luna revendica (claim) implicit videoclipurile cu destinatie (optiunea `repeta:true` forteaza repostarea); diagnoza prin `status`, `errors`, `permissions`, `clear-errors` — `errors` si numaratoarea din `status` citesc colectia dedicata `guildYoutubeErrors`, iar `clear-errors` (si `/reset-config`) o golesc per guild; toate operatiile sunt protejate de admin guard si raspund ephemeral.

### `src/features/command-handlers/reportInteractionHandler.ts`

- Gestioneaza `/report submit`, `/report list` si `/report resolve`.
- `submit` ramane public pentru raportarea problemelor, iar `list`/`resolve` folosesc guard runtime de administrator fiindca top-level-ul `/report` trebuie sa ramana accesibil public pentru raportare.
- Delegheaza construirea embed-urilor/textelor de raport (`buildReportConfirmEmbed`/`buildReportAlertBody`/`buildReportListEmbed`) modulului pur `reportViews.ts`; le re-exporta pentru compatibilitate.

### `src/features/command-handlers/reportViews.ts`

- Functii pure de prezentare pentru `/report`: `buildReportConfirmEmbed` (embed de confirmare), `buildReportAlertBody` (corpul alertei admin) si `buildReportListEmbed` (lista rapoartelor, cu truncare si `clampJoinedList`), plus tipul `ReportRecord`.
- Fara acces la Mongo/Discord/DI; depinde doar de `feedback.reportTypeLabel` si `clampJoinedList`. Testabil izolat.

### `src/features/command-handlers/autocompleteInteractionHandler.ts`

- Gestioneaza autocomplete pentru optiunile slash commands: rutarea cererii (help/snooze/admin-scope/youtube/joc), scoring-ul de referinta (`scoreGameAgainstInput`) si predicatul `acceptsGameOption`.
- Delegheaza scoring-ul, sortarea si limitarea optiunilor de joc catre `buildAutocompleteChoices` (TS-primary — masurat mai rapid decat nativul pe marshaling, vezi `BENCHMARKS.md`).
- Delegheaza construirea pool-urilor de alegeri care citesc setarile guild-ului catre `autocompleteChoiceBuilders.ts`.
- Trebuie tinut separat de logica de executie a comenzilor.

### `src/features/command-handlers/autocompleteChoiceBuilders.ts`

- Factory `createAutocompleteChoiceBuilders({ logger, getGuildSettings })` care intoarce cele cinci constructoare de alegeri ce depind de setarile guild-ului: `buildSetGamesRemovePool`, `buildPriceAlertRemovePool`, `buildYouTubeChannelChoices`, `buildYouTubeRouteChoices`, `buildYouTubeTitleWordChoices`.
- Fiecare este best-effort: la eroare de citire logheaza WARN si cade pe un fallback sigur (jocurile primite sau lista goala), fara sa arunce. Detine si limitele Discord de autocomplete (`MAX_AUTOCOMPLETE_*`/`MAX_CHOICE_*`). Testabil izolat cu un `getGuildSettings` fals.

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

### `src/features/notifications/notificationOutbox.ts` (+ `outboxTypes.ts`, `outboxDedupe.ts`, `outboxRepository.ts`, `outboxStateMachine.ts`, `outboxDeliveryFinalizer.ts`)

- `notificationOutbox.ts` e orchestratorul cozii: `createOutboxRuntime` compune modulele si expune `enqueueOutbox` + `drainOutbox` (bucla claim -> validare -> livrare -> finalizare, sweep-ul TTL, contoarele si log-urile de drain), cu contract public identic (tipurile si helper-ele de dedupe raman re-exportate de aici).
- `outboxTypes.ts` tine union-ul discriminat `OutboxJob` (`update` | `discount` | `youtube`), payload-ul + guard-ul structural `isDeliverableOutboxPayload`, contractele de model si tipurile de drain (optiuni/rezultat/`DeliverResult`).
- `outboxDedupe.ts` tine `dedupeKeyFor` (hash SHA-256 pe forma stabila a payload-ului) + marker-ele de dedupe pentru recovery (`applyDedupeMarker`, `messageHasDedupeMarker`, `outboxDedupeMarker`).
- `outboxRepository.ts` e singurul loc care atinge modelele Mongo: insert cu absorbirea E11000, `alreadySent`/`markSent`, claim-ul atomic cu lease (`claimNextJob`), `scheduleRetry` (`$set`+`$unset`), metricile de coada (`countQueued`/`oldestJobAgeMs`/`futureScheduledCount`) si citirea/stergerea lease-free pentru sweep-ul TTL.
- `outboxStateMachine.ts` tine verdictul tipizat al validarii (`OutboxJobVerdict`: deliver / drop-duplicate / expire / drop-unsubscribed / retry / dead-letter, in exact aceasta ordine de verificare) + politica de backoff cu jitter si plafon de 30 min. Acoperit de `outboxStateMachine.test.ts`.
- Decizia terminala pe incercari e comuna intre toate caile cu `attempts` (update / discount / outbox): `notificationFailurePolicy.ts` expune `planNotificationFailure(previousAttempts, maxAttempts, permanent?)` -> `{ action: "requeue" | "dead-letter", attempts, cause?: "permanent" | "max-attempts" }`, iar `planPendingFailure` (updates, cu mutatia `item.attempts` pastrata), `planDiscountFailure` (reduceri, cu copia imutabila `retry` pastrata) si `retryOrDeadLetter`-ul din drain (outbox, unde `permanent` scurtcircuiteaza pragul, iar `cause` alege intre motivul apelantului si `max-attempts`) deleaga toate la acelasi nucleu. YouTube si price-alerts raman INTENTIONAT pe claim/rollback (reincercarea e implicita prin re-claim la ciclul urmator, fara contor de incercari) — mutarea lor pe attempts ar schimba comportamentul. Acoperit de `notificationFailurePolicy.test.ts`.
- `outboxDeliveryFinalizer.ts` tine livrarea cronometrata cu exceptiile tratate ca esec tranzitoriu (`deliverClaimedJob`) si finalizarea unui job livrat (`finalizeDeliveredJob`: istoric best-effort, `markSent` cu dead-letter de audit + oprirea drain-ului la esec, stergerea jobului), intorcand un outcome structurat din care orchestratorul isi incrementeaza contoarele.

### `src/features/notifications/rollbackReporter.ts`

- `rollbackOrReport(rollback, logger, context, report?)`: ruleaza anularea (rollback) unei revendicari de deduplicare; la esec **nu mai inghite** eroarea, ci logheaza WARN (context `ROLLBACK`, cu elementul + guild-ul) si invoca callback-ul optional `reportRollbackFailure` (conectat in wiring la `adminAlert`, familia `rollback-failed`). Folosit de `youtubeNotificationService` (3 site-uri) si `priceAlertService` ca un esec de rollback (Mongo indisponibil) sa devina vizibil operational, nu o pierdere tacuta.

### `src/features/notifications/priceAlertService.ts`

- Potriveste ofertele prin `appId` sau titlu/alias normalizat si alege cea mai ieftina oferta valida.
- Revendica atomic alerta in documentul guild-ului inainte de send, face rollback la esec (prin `rollbackOrReport`, deci un rollback esuat e raportat) si o rearmeaza numai dupa ce pretul revine peste prag.

### `src/features/notifications/updateNotificationService.ts`

- Proceseaza update-urile noi; serviciul e orchestrator peste separarea planner / executor / persistence: deciziile pure stau in `updateNotificationPlanner.ts`/`pendingUpdatesQueue.ts`, trimiterea in `notificationBatchExecutor.ts`, iar scrierea finala de ciclu in `notificationCycleRepository.ts`.
- Verifica deduplicarea prin repository.
- Construieste embed-urile si le preda executorului comun (`sendEmbedBatch`), cu callback-urile per-tip pentru rollback (`rollbackSeenUpdate` pe `(gameKey, id)`), dezactivare la eroare permanenta si requeue-in-fata/dead-letter la esec tranzitoriu (ordinea inversa a requeue-ului e pastrata in callback).
- Snapshot-ul de rezerva din event store trece prin `validateUpdateFetchSnapshot` (itemii fara `game.key`/`game.name`/`latest.id` valide sunt eliminati; daca nimic nu trece, fallback-ul e tratat ca inexistent, fara dispatch pe date neverificate); `checkForUpdates` e tipat `GameConfig[]` end-to-end (serviciu -> registry -> appRuntime -> cron).
- Esecul total e propagat, nu inghitit: fetch picat fara snapshot proaspat, toate guild-urile esuate la dispatch sau **toate jocurile cu `latest: null` si erori reale (non-abort)** -> `checkForUpdates` arunca, deci cron-ul marcheaza ciclul esuat (metrics + admin alert + health window); esecul partial ramane doar logat. Un rezultat integral `latest: null` nu se persista niciodata ca snapshot (ar deveni fallback fals-proaspat care mascheaza caderea).

### `src/features/notifications/discountNotificationService.ts`

- Proceseaza reducerile noi; acelasi tipar planner / executor / persistence ca la update-uri: deciziile pure in `discountNotificationPlanner.ts`, trimiterea prin `sendEmbedBatch` (rollback pe `hash`, dezactivare la permanent, `retryOrDeadLetter` in ordine la tranzitoriu), scrierea finala prin `persistGuildCycleState`.
- Verifica deduplicarea prin repository.
- Foloseste `dealPassesFilters` pentru a respecta setarile guild-ului.
- Snapshot-ul de rezerva pentru reduceri trece prin `validatePendingDiscountSnapshot` (snapshot corupt = fallback inexistent, fara dispatch).
- Esecul total e propagat, nu inghitit: `checkForDiscounts` inspecteaza rezultatul `runConcurrent` si arunca daca toate guild-urile abonate au esuat (ex. fetch picat pentru toate monedele, fara snapshot proaspat); esecul partial ramane doar logat.

### `src/features/notifications/notificationBatchExecutor.ts` (+ `notificationCycleRepository.ts`)

- `sendEmbedBatch` e executorul comun al pipeline-ului de notificari (update-uri + reduceri): imparte batch-ul in mesaje prin `packEmbedsByBudget` (max 10 embed-uri, buget de caractere), pune content-ul/mentiunea de rol doar pe primul mesaj, scrie `historyEntries` per chunk si respecta pauza dintre mesaje; la esec face rollback best-effort pe TOATE chunk-urile ramase, apoi clasifica: eroare permanenta Discord -> `onPermanentError("Discord cod X: ...")` (dezactivarea canalului ramane in serviciu), altfel `onTransientFailure(failed, err)` (requeue/dead-letter per-tip ramane in serviciu) si se opreste. Acoperit de `notificationBatchExecutor.test.ts`.
- `persistGuildCycleState` e pasul de persistence al ciclului: un singur `updateOne` cu `$set` pe filtrul de abonare (guild inca abonat pe acelasi canal), iar dead-letter-ele se scriu in colectia dedicata doar daca scrierea principala a gasit documentul. Acoperit de `notificationCycleRepository.test.ts`.

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
- Face rollback la esec de metadate/livrare si actualizeaza ultima verificare a canalului (`lastError` per canal ramane pe subdocumentul `youtubeChannels`).
- Dezactiveaza notificarile cand canalul principal devine permanent invalid si elimina numai rutele speciale devenite invalide.
- Jurnalul de erori YouTube traieste in colectia dedicata `guildYoutubeErrors` (prin `youtubeErrorsRepository`: `recordYoutubeError` cu evictia celor mai vechi peste capul de 20 per guild, `listYoutubeErrors`/`countYoutubeErrors` sortate descrescator, `clearYoutubeErrors`); scrierea de eroare nu mai e `$push` combinat pe documentul guild, ci un `create` separat dupa scrierea principala (si doar daca aceasta a gasit documentul).

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
- `sources/runtime.ts` e adaptorul explicit si INGUST dintre surse si restul aplicatiei (review impact-mare #5): expune bibliotecile de fetch/parsing (`axios`, `cheerio`, `rss-parser`, `crypto`) plus EXACT campurile alese din `mongoContext` de care stratul de surse are nevoie (`env`, `logger`, `getAbortSignal`, `getCurrencyConfig`, `formatPrice`, `runConcurrent`, `adminAlert`, `SchemaDriftError` si `CircuitBreakerModel` — singura persistenta legitima, starea circuit breaker-ului) — NU mai face spread pe tot contextul Mongo, deci modelele guild/outbox/audit nu se mai scurg in zona de scraping; `updatesContracts` tipizeaza modelul structural (`CircuitBreakerModelLike`, doar `findOneAndUpdate`/`updateOne`), fara tipul `Model<>` din mongoose.
- Metricile HTTP folosesc un holder stabil in `infra/http/client.ts`: `attachMetrics` schimba referinta in holder, iar consumatorii citesc tarziu prin `getHttpMetrics()` — inainte, `metricsRef` era copiat prin spread la compunerea registrului, deci dupa `attachMetrics` circuit breaker-ul incrementa un obiect orfan si `fetchSuccess`/`fetchFail` din ciclurile de update nu mai ajungeau la `/metrics` (bug real reparat de acest refactor).
- Contractul registrului e **value-tipat din tipuri reale**: `SourceRegistryApi` e compus prin indexed access din `SteamSourceApi`/`DealsApi`/`UpdatesApi` (modulul partajat `sources/sourceApis.ts`) + tipurile-domeniu din `sources/sourceTypes.ts` (`DealInfo`, `NormalizedUpdate`, `PatchUpdate`, re-exportate prin agregatorul `types.ts`) — fara `unknown` pe functiile de sursa; tipul e si exportat (`export type { SourceRegistryApi }`). Acoperit de `sourceRegistryTypedApi.test.ts`.
- `createSourceRegistry(): SourceRegistryApi` (fara parametri) compune **explicit, prin valorile returnate de factory-uri** (nu mutatie pe context): construieste un **context proaspat per registry** (`freshSourceContext()` = copie shallow a modulului `runtime`), apoi compune **imutabil** prin spread in obiecte noi (`{ ...base, ...attachHttpClient.buildFrom(base) }` -> `attachSteam.buildFrom(withHttp)` -> `attachUpdates.buildFrom(withSteam)` -> `attachDeals.buildFrom(withUpdates)`), in ordinea dependentelor, fara `Object.assign(context, ...)` in-place pe un context partajat; registrul returnat e `Object.freeze`-uit (nu mai exista `defaultInstallers: SourceInstaller[]` + bucla). Fiecare modul de sursa expune un `buildFrom(context)` care **intoarce** contributia (`createX`-ul sau), iar `attachX` deleaga la el (`Object.assign(target, buildXFrom(target))`), deci maparea de deps e intr-un singur loc, fara duplicare. Compunerea atinge copia proaspata, nu singletonul `runtime` partajat; exportul singleton `registry` ramane un wrapper peste un astfel de build, iar `buildSourceRegistry`/`requireSourceValue` extrag exportul **inchis** `SourceRegistryApi` (fail-fast pe cheie lipsa). Garda in `sourceRegistry.functional.test.ts` (registry-ul are toate exporturile + modulul `runtime` nu capata chei dupa un build) si `registryClosedContracts.test.ts` (fara `SourceInstaller`/`defaultInstallers`, compunere prin `build*From` ordonate).

### `src/sources/updates/` (split pe functionalitate)

- Fetch-uieste update-uri din Steam, RSS, HTML listing si surse custom; foloseste Rust pentru curatare text, scoring URL/listing si clasificare patch notes.
- `index.ts` — orchestrator subtire: `createUpdates(deps)` compune sub-modulele (`createUpdatesSourceDispatch` -> `createUpdatesCircuitBreaker` -> `createUpdatesFetchOrchestrator`) si intoarce contractul public `UpdatesApi`; `attachUpdates`/`buildFrom` raman adaptorul public neschimbat.
- `updatesContracts.ts` — tipurile partajate (`CircuitBreakerDoc`, `UpdatesDeps`, `UpdatesContext = UpdatesDeps & Partial<UpdatesApi>`).
- `updatesSourceDispatch.ts` — `createUpdatesSourceDispatch(deps)` compune cele 4 factory-uri per sursa (steam/listing/driver/platform), ruteaza pe tip (`fetchGameUpdateForSource`) si tine lantul de fallback (`fetchGameUpdate`, care incearca `game.fallbacks` in ordine si adauga esecurile lor la eroarea principala).
- `updatesCircuitBreaker.ts` — `createUpdatesCircuitBreaker(deps, fetchGameUpdate)` -> `executeFetchWithCircuitBreaker`: citeste/reseteaza state-ul CB, distinge `SchemaDriftError` (contor + alerta `drift:<key>`) de esecurile normale (contor + alerta `cb:<key>`), aplica cooldown cu jitter la prag, incrementeaza `fetchSuccess`/`fetchFail`. Acoperit de `updatesCircuitBreaker.test.ts`.
- `updatesFetchOrchestrator.ts` — `createUpdatesFetchOrchestrator(deps, executeFetchWithCircuitBreaker)` -> `getLatestForAllGames`: grupeaza jocurile pe `sourceConcurrencyGroup` cu concurenta per grup, tine coalescing-ul `inflightAllGames` (cheie din `buildCoalesceSignature`, semnatura completa a sursei, nu doar `key`) si respecta override-ul `deps.executeFetchWithCircuitBreaker`.
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

### `src/native/core/src/` (crate-ul pur `discord_patch_bot_logic`, module pe responsabilitate)

- `lib.rs` e doar declaratiile de module + `pub use` (contractul public al crate-ului, neschimbat fata de consumatorul N-API) + testele unitare (`cargo test -p discord_patch_bot_logic`, fara build N-API).
- Modulele: `types.rs` (structurile de date partajate `GameCandidateData`/`FuzzyMatch`/`AutocompleteChoiceData`/`ListingCandidateData`), `text.rs` (helper-ele pure de text: `levenshtein`, `normalize_title_for_dedupe`, `clean_text`, `normalize_command_text`, `truncate_chars`), `hashing.rs` (`stable_update_id`, `normalize_deal_state`, `deal_hash` + `sha256_hex`/`hex_encode`), `deals.rs` (`deal_passes_filters`), `updates.rs` (`is_good_steam_article_url`, `extract_date_score` + aritmetica de data, `classify_patch_note` + listele de cuvinte), `autocomplete.rs` (`build_autocomplete_choices` + scoring), `listing_rank.rs` (`score_listing_candidate`, `rank_listing_candidates`), `fuzzy.rs` (`find_game_keys` + `game_identifiers`).
- Nu trebuie sa depinda de Discord, Mongo, HTTP, env sau filesystem.

### `src/native/src/lib.rs`

- Wrapper-ul cdylib N-API (`discord_patch_bot_core`): doar structuri `#[napi(object)]` si functii `#[napi]` care deleaga la `discord_patch_bot_logic`.
- Numele cdylib-ului ramane neschimbat, deci fisierul `.node`, `index.js` si `index.d.ts` generate de `napi build` raman identice.

### `src/native/fuzzy.ts` (+ `fuzzyNativeBridge.ts`, `fuzzyFallbacks.ts`, `fuzzyFallbackMetrics.ts`)

- `fuzzy.ts` e API-ul public: wrapper-ele care incearca nativul si cad pe fallback-ul TypeScript, cu acelasi set de exporturi ca inainte de split (inclusiv fallback-urile si helper-ele re-exportate).
- `fuzzyNativeBridge.ts` incarca addon-ul `.node` (cautare, validarea exporturilor critice de hash, fail-fast in productie fara ALLOW_NATIVE_FALLBACK, stare unica de modul incarcat) si expune `getNativeFuzzy`/`ensureNativeFuzzy`/`nativeStringFn`.
- `fuzzyFallbacks.ts` tine implementarile TypeScript pure (levenshtein, clasificare patch-note, scoring listing/autocomplete, hash-uri, filtre de deal, `findGameKeysFallback`, `rankListingCandidatesFallback`, `reorderByValidPermutation`) + `HASH_VERSION`.
- `fuzzyFallbackMetrics.ts` tine contoarele de fallback per functie (`recordNativeFallback` cu throttle de log, `getNativeFallbackTotals`, `NATIVE_FALLBACK_FUNCTIONS` pentru seriile de metrici).
- Trebuie sa pastreze contract identic intre Rust si TypeScript; bridge-ul logheaza explicit cand addon-ul nativ lipseste in productie. Gardat de `fuzzyModuleSplit.test.ts` (re-exporturile sunt aceleasi referinte, stare nativa partajata, coerenta wrapper/fallback).

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
- `updateNotificationService.functional.test.ts` si `discountNotificationService.functional.test.ts` (helpers partajate in `notificationServiceTestKit.ts`);
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`.
- `sourceScraperShapeDrift.test.ts`.

Teste E2E:

- flux update: `/start updates` -> guild in Mongo -> cron gaseste update -> trimite embed -> marcheaza seen;
- flux reduceri: `/start reduceri` -> baseline reduceri -> cron -> deal embed -> `seenDiscounts`;
- flux YouTube: `/youtube subscribe` -> baseline `guildSeenYoutube` -> `/youtube notify on` -> cron grupeaza feed-urile -> filtre/metadate -> embed/outbox/history.

### `src/sources/sourceHealth.ts` + `src/infra/mongo/sourceHealth.ts`

- `sourceHealth.ts` (pur): `classifySourceHealth` (healthy/degraded/cooling-down/schema-drift din starea circuit breaker-ului per joc) + `summarizeSourceHealth`. `infra/mongo/sourceHealth.ts` incarca starea din `CircuitBreakerModel` (`loadSourceHealth`, wired in `mongoContext` dupa fetchSnapshots). `/sources status` afiseaza sumarul + sursele cu probleme. Acoperit de `sourceHealth.test.ts` si `sourcesStatusHandler.functional.test.ts`.
