# Context repo curat

Documentul descrie starea curenta a repo-ului dupa migrarea treptata din fisiere mari legacy spre module organizate pe functionalitate.

## Starea curenta

- Codul principal este in `src/`.
- `src/package.json`, `src/package-lock.json`, `src/.env.example` si `src/tsconfig.json` sunt fisierele active pentru build/test/runtime Node.
- Fisierele active sunt grupate pe functionalitati, nu duplicate la radacina.
- `src/features/command-router/` nu mai reprezinta arhitectura curenta.
- Comenzile cunoscute si autocomplete-ul sunt mutate in `src/features/command-handlers/`.
- `fallbackInteractionHandler.ts` este doar fallback de final pentru interactiuni necunoscute sau ramase neacoperite.
- `notifications/index.ts` este wiring pentru job-uri; logica de update-uri si reduceri este in servicii dedicate. Wiring-ul central traieste in **module-factory pe domenii**: `outboxRuntimeFactory.ts` (`createOutboxServices`: outbox + history + dead-letter replay + `resolveOutboundChannel` + delivery + drain, plus `outboxSubscriptionFilter`/`createIsStillSubscribed`), `seenRuntimeFactory.ts` (`createSeenServices`), `updateNotificationRuntime.ts` (`createUpdateNotificationRuntime`), `discountNotificationRuntime.ts` (`createDiscountNotificationRuntime`: discount + price alerts, care fac parte din fluxul de reduceri) si `youtubeNotificationRuntime.ts` (`createYouTubeNotificationRuntime`: source + repository + service). Contractul de deps (`NotificationsRuntimeDeps`, listele `Generated*Deps`) si `createReportRollbackFailure` stau in `notificationRuntimeContracts.ts`. `index.ts` e orchestrator subtire: `createNotificationDispatchServices` compune cele trei runtime-uri de domeniu, iar `createNotificationRuntime` compune outbox + seen -> dispatch in ordinea dependentelor si intoarce acelasi API plat; installer-ul si exporturile statice raman neschimbate. Gardat de `registryClosedContracts.test.ts`.
- Rust/N-API este folosit doar pentru hot-path-uri pure, cu fallback TypeScript in `src/native/fuzzy.ts`.
- Registrele de compunere (`commandRegistry`, `sourceRegistry`) folosesc importuri statice pentru module si contracte inchise la iesire (`CommandRegistryContext` fara index signature, `SourceRegistryApi` value-tipat); compozitia nu mai foloseste `as never`, `as unknown as` sau `LegacyInstallerTarget`. `commandRegistry` nu mai are mecanism de installers dinamici: compune explicit si **imutabil** prin factory-uri reale tipate (`createCommandCache`, `createCommandPresentation`, `createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) intr-un `createAppServices` (fiecare zona prin **spread in obiecte noi**, fara `Object.assign(base, ...)` pe un singur obiect mutat; registrul public returnat e **`Object.freeze`-uit**), plus o **lista tipata `CommandHandler[]`** (din `attachX.buildCommandHandler(ctx)`) rutata de `dispatchCommand` (loop `canHandle`/`handle`), cu guard-urile compuse ca **pipeline explicit de functii** in registry (admin guard exterior -> snooze guard -> `dispatchCommand`, aceeasi ordine ca inainte), construite prin `createAdminCommandGuard`/`createCommandSnoozeGuard` — fara instalare prin mutarea contextului (`ctx.handleInteraction` se seteaza O data, la finalul compunerii); `commandSnoozeGuard` e factory-only (`export = { createCommandSnoozeGuard, isSnoozeEligibleInteraction }`), iar install-form-ul `adminCommandRouterGuard` ramane doar seam de test. Registry-ul cere fail-fast prin `requireInstalled` functiile adaugate de handler-e (`handleInteraction`/`buildHelpEmbed`), intorcand contractul inchis `RequiredCommandRegistry` verificat de `tsc`; `sourceRegistry` (`createSourceRegistry(): SourceRegistryApi`, fara parametri) nu mai are `SourceInstaller[]`/`defaultInstallers`/bucla dinamica — compune prin **valorile returnate** de `attach*.buildFrom(...)` prin **spread in obiecte noi** (`{ ...prev, ...attachX.buildFrom(prev) }`, fara `Object.assign(context, ...)` in-place; registru `Object.freeze`-uit), fiecare modul expune un `buildFrom` care intoarce contributia, ordonat (`http -> steam -> updates -> deals`), si citeste exporturile prin `requireSourceValue` pe fiecare cheie. Boot-ul (`main.ts`) si `commandRuntimeContext` folosesc require-uri tipate cu `typeof import(...)`, deci `satisfies AppRuntimeDeps` si return type-ul `CommandRuntimeContext` verifica wiring-ul real; `createSourceRegistry` aplica `assertNoUndefinedExports` pe registry-ul construit din contextul proaspat per apel. La fel, `mongoContext` compune acum prin **factory-return imutabil, complet ca `sourceRegistry`**: fiecare modul installer (cele 4 din `shared/` + cele 7 din `infra/mongo/`) expune un `buildFrom(context)` care **intoarce** contributia, iar `attachX(target)` deleaga la el (`Object.assign(target, buildXFrom(target))`). `createMongoContext` porneste de la o **copie proaspata** (`{ ...baseContext }`) si compune prin **spread in obiecte noi** (`{ ...prev, ...attachX.buildFrom(prev) }`) in ordinea dependentelor (`logging -> ... -> fetchSnapshots`), fara mutatie pe un context partajat in timpul compunerii; exportul singleton e `Object.freeze`-uit. Ordinea garanteaza ca niciun `buildFrom` nu citeste un camp adaugat ulterior (fara forward-reference). Modulele Mongo/shared isi **pastreaza** adaptorul `attachX(target)` ca thin-wrapper fiindca e folosit si direct de scripturi/teste de integrare (`acquireDbLock`, `guildSettingsCache`); exceptie `models.ts`, trecut complet pe factory-only (`export = { buildFrom }`, R5 #3) — consumatorii lui directi (`check-db-indexes`, `outboxLoadBenchmark`, testele de integrare outbox/seen) apeleaza `buildFrom` si isi fac singuri `Object.assign` pe contextul propriu.
- TypeScript strict e activ **global** prin `strict: true` in `src/tsconfig.json` (migrarea incrementala s-a incheiat; fostul `tsconfig.strict.json` — un subset cu aceleasi flag-uri — a fost eliminat ca redundant, dubla doar timpul de typecheck).
- `legacy-dynamic.d.ts` nu mai exista; tipurile dinamice trebuie modelate local.
- Documentatia istorica versionata a fost scoasa din cod; fisierele curente de documentatie raman sursa de adevar.
- Referinta completa de comenzi (`docs/Referinta Comenzi.md`) este **generata**, nu scrisa de mana: `renderCommandReferenceDoc` (`features/command-catalog/commandReferenceDoc.ts`) o produce din `COMMAND_CATALOG_HELP` — aceeasi sursa unica din care deriva `COMMAND_HELP_ENTRIES` folosit de `/help` — deci referinta din docs si ajutorul din Discord nu pot diverge. Regenerare: `npm run docs:commands`. Anti-drift: `npm run check:docs-commands` (`scripts/generate-command-reference.ts --check`, inclus in agregatul `npm run check` si in CI) regenereaza in memorie si esueaza daca fisierul comis nu mai corespunde catalogului (comparatie normalizata la CRLF); dublat de `commandReferenceDoc.test.ts` in suita. `docs/Comenzi Functionalitate.md` ramane explicatia narativa grupata pe functionalitate si linkuieste referinta generata.
- Comentariile explicative din fisierele de cod au fost eliminate complet (zero exceptii). Daca un rationale trebuie pastrat, el sta in documentatie dupa subiect, nu langa implementare. Regula este aplicata automat de `scripts/check-no-comments.ts` (parte din `npm run check`, deci si in CI): scaneaza `.ts`/`.js`/`.rs` (parser TypeScript pentru TS/JS ca sa nu existe fals pozitive pe regex/URL; scanner cu ignorare de string-uri pentru Rust) si esueaza la orice comentariu; allowlist-ul de exceptii este gol.
  - **Scope: doar cod sursa runtime/test** (`.ts`/`.js`/`.rs`). Fisierele care nu sunt cod — workflow-uri GitHub Actions (`.yml`), `Dockerfile`, `Markdown`, `JSON` de config — NU intra sub regula si pot purta comentarii explicative (ex. comentariile care documenteaza gate-urile din `release.yml`/`ci.yml`). `checkedExtensions` din scanner enumera exact extensiile acoperite (`.ts`/`.js`/`.rs`), deci restul fisierelor nici nu sunt citite.
- Codul sursa nu foloseste constructii care slabesc tiparea (regula 2), aplicata automat de `scripts/check-no-weakening-types.ts` (parte din `npm run check`, deci si in CI): scaneaza `.ts`/`.js`, inclusiv `src/test`, pe **AST** si esueaza la `any`, `as never` sau dubla asertiune `as unknown as`. NU sunt interzise `unknown` (tipul top, type-safe) si casturile de **narrowing** care ingusteaza din `unknown`/date dinamice externe (Mongo lean, Discord.js, JSON de la API-uri) la un tip utilizabil (`value as Record<string, unknown>`, `item as DealInfo`, `require(...) as typeof import(...)`) — acelea intaresc tiparea. Exceptia regulii 2 pentru teste este reprezentata de un allowlist explicit de fisiere bug-catching, in prezent doar `src/test/checkNoWeakeningTypes.test.ts`; restul testelor sunt scanate normal. Root-ul de scanare e calculat explicit din locatia scriptului (`path.resolve(__dirname, "..", "..")` = `src/`), nu din `process.cwd()`, iar matching-ul de allowlist/ignore accepta atat `test/...` cat si `src/test/...`, deci gate-ul da acelasi rezultat indiferent din ce director e rulat.
- `types.ts` este **agregator**, nu proprietar: contractele de domeniu sunt definite langa domeniul lor si re-exportate din `types.ts` pentru compatibilitatea celor ~76 de consumatori care importa in continuare din `../types` (churn zero). Tipurile de configuratie (`GameType`, `GameSourceFallback`, `GameConfig`, `BotConfig`, `ConfigLoadResult`) traiesc in `config/configTypes.ts`, metricile (`BotMetrics`) in `app/health/metricsTypes.ts`, rate-limiterul (`RateLimitBucket`, `RateLimitRequest`, `RateLimiter`) in `app/health/rateLimitTypes.ts`, iar cron-ul (`CronHealthSnapshot`, `CronController`) in `app/scheduler/schedulerTypes.ts`; modulele proprietare (`configLoader`/`configValidator`, `metrics`, `rateLimit`, `cron`) importa direct din fisierul lor de tip, nu din agregator. `types.ts` pastreaza doar contractele cu adevarat globale (primitive: `LoggerFunction`, `ParseEnvNumber`, `AbortPredicate`; `RuntimeEnv`; `CurrencyConfig`/`CurrencyRegistry`; `GuildSettings`; tipurile de cache/pagination/http). Identitatea re-export ↔ definitie de domeniu si absenta definitiilor inline din agregator sunt gardate compile-time + runtime de `domainTypesLocality.test.ts`.
- Doua puncte de concurenta subtile din `cron.ts` (rationale-ul lor, mutat din cod aici): (1) heartbeat-ul de reinnoire a lock-ului se re-armeaza (`setTimeout(tick)`) **doar** cat timp `currentCronToken === lockToken` — altfel un tick aflat in zbor ar reinnoi un lock deja eliberat, care intre timp poate fi al altei instante. (2) La finalul ciclului, `currentCronToken` este invalidat (`= null`) **inainte** de `stopHeartbeat()` / `releaseDbLock("cron_main")` — astfel un tick de heartbeat aflat in zbor vede `currentCronToken !== lockToken` si nu se re-armeaza dupa eliberarea lock-ului. Ordinea acestor operatii previne reinnoirea unui lock instrainat; orice refactor in `cron.ts` trebuie sa o pastreze.
- CI (`ci.yml`) valideaza si MongoDB real (serviciu `mongo:7`, folosit de testul de integrare `outboxMongoIndex.integration.test.ts` care verifica indexul unic sparse pe `notificationOutbox.dedupeKey`) si Rust (`cargo clippy --workspace --all-targets -- -D warnings` + `cargo test -p discord_patch_bot_logic` pe crate-ul pur, pe langa compilarea prin `napi build`).
- Codul runtime nu mai foloseste abrevierea legacy pentru context; modulele de compatibilitate folosesc `target` pentru atasare si `deps` pentru factory-uri. Migrarea factory-urilor este incheiata: logica modulelor este expusa prin `createX(deps: XDeps): XApi` cu dependinte explicite, iar acolo unde mai exista, `attachX(target)` e doar adaptor subtire (`Object.assign(target, createX(...))`). Tiparul factory este aplicat la `sources/steam`, `sources/deals`, `sources/updates`, `command-presentation` si `infra/http/client.ts`; **trei module au trecut complet pe factory-only, fara nicio forma de atasare pe target** (review R5 #3): `features/notifications/index` (exporta `{ createNotificationRuntime, createIsStillSubscribed, outboxSubscriptionFilter }`), `features/command-cache/commandCache` (exporta `{ createCommandCache, computeMissingChannelPerms, formatMissingChannelPerms }`) si `infra/mongo/models` (exporta `{ buildFrom }`); consumatorii lor (commandRegistry, mongoContext, testele e2e, `check-db-indexes`, testele de integrare Mongo) compun explicit prin factory/`buildFrom`, gardat de `commandInstallerTargetContracts.test.ts`; contractele de boot din `appRuntime` folosesc tipuri explicite (`CommandRuntime`, `ScraperRuntime`, `ActiveLocks`), iar factory-urile centrale din boot wiring (`createCronController`, `createOutboxWorker`, `createHttpServer`, `createHousekeeping`, `registerDiscordEvents`/`registerMongoEvents`, `createShutdownController`) primesc tipurile reale de deps exportate de modulele lor, cu `env` complet `RuntimeEnv` (gard compile-time in `appRuntimeTypedDeps.test.ts`). `SourceRegistryApi` si `MongoRuntimeContext` sunt value-tipate, iar `sources/sourceApis.ts` expune tipurile reale ale API-urilor de surse. Coalescing-ul inflight (`inflightAllGames`, `inflightDeals`, `activeEnrichments`) traieste in closure-ul fiecarei instante de factory, deci instantele cu deps diferite nu impart promisiuni. La nivel de modul raman doar cache-uri pure si deterministe (`enrichedCache`, cache-ul de regex). Singurele `[key: string]: unknown` ramase sunt intentionate: tipuri de date dinamice, schema Mongo si adaptoarele `& Record<string, unknown>` ale modulelor de surse (input de compatibilitate al `attachX`-urilor pe care `sourceRegistry` le compune acum explicit, prin apeluri `attach*` ordonate). Ambele registre (`commandRegistry`, `sourceRegistry`) intorc contracte inchise compuse explicit (`RequiredCommandRegistry`, `SourceRegistryApi`), nu bag-uri de wiring.
- Testele din `src/test` nu mai folosesc abrevieri legacy de context sau tipuri wildcard nesigure; mock-urile Discord/Mongo/HTTP folosesc shape-uri locale si `unknown` pentru cazuri intentionat invalide.
- Helper-ele de test si variabilele de wiring trebuie numite explicit, de exemplu `makeContext`, `runtimeContext` si `validationContext`.

## Structura logica

```text
src/
  app/
    main.ts
    appRuntime.ts
    health/
      metrics.ts
      metricsTypes.ts
      rateLimit.ts
      rateLimitTypes.ts
    lifecycle/
    scheduler/
      cron.ts
      schedulerTypes.ts
  config/
    configLoader.ts
    configValidator.ts
    configTypes.ts
  domain/
    deals/
      filtersCore.ts
  features/
    admin-records/
      adminRecordsTypes.ts
    command-cache/
      commandCache.ts
      runtimeLimits.ts
      commandCaches.ts
      userCooldowns.ts
      channelPermissionChecks.ts
      userErrorFormatting.ts
    command-definitions/
      slashCommandDefinitions.ts
      slashDefinitionTools.ts
      coreCommandDefinitions.ts
      adminCommandDefinitions.ts
      notificationCommandDefinitions.ts
      dealsCommandDefinitions.ts
      gameInfoCommandDefinitions.ts
      youtubeCommandDefinitions.ts
      outboxCommandDefinitions.ts
    command-handlers/
      auditLogInteractionHandler.ts
      autocompleteChoiceBuilders.ts
      autocompleteInteractionHandler.ts
      backupInteractionHandler.ts
      backupViews.ts
      configInteractionHandler.ts
      configView.ts
      dealScoreInteractionHandler.ts
      dlcInteractionHandler.ts
      dlcSteamPage.ts
      fallbackInteractionHandler.ts
      futureReleaseInteractionHandler.ts
      gameFilterHandlers.ts
      gameInfoEmbeds.ts
      gameInfoEmbedPrimitives.ts
      dealsEmbeds.ts
      comparisonEmbeds.ts
      steamMetadataEmbeds.ts
      playerCountEmbeds.ts
      gameInfoInteractionHandler.ts
      gameInfoLookupService.ts
      helpInteractionHandler.ts
      latestInteractionHandler.ts
      maintenanceInteractionHandler.ts
      outboxAdminContracts.ts
      outboxAdminHandler.ts
      outboxAdminOperations.ts
      outboxAdminViews.ts
      reportInteractionHandler.ts
      reportViews.ts
      rolePingHandlers.ts
      setInteractionHandler.ts
      setUpdatePlan.ts
      simpleCommandsHandler.ts
      snoozeInteractionHandler.ts
      sourcesStatusHandler.ts
      sourcesStatusView.ts
      statusInteractionHandler.ts
      priceCheckInteractionHandler.ts
      priceCheckComparison.ts
      suggestCommandInteractionHandler.ts
      subscriptionNotificationHandlers.ts
      watchlistGameSuggestionHandler.ts
      youtubeInteractionHandler.ts
    command-catalog/
      commandCatalog.ts
      commandCatalogTypes.ts
      coreCatalog.ts
      gameInfoCatalog.ts
      notificationsCatalog.ts
      youtubeCatalog.ts
      adminCatalog.ts
      commandModuleDescriptors.ts
      commandReferenceDoc.ts
    command-presentation/
      commandPresentation.ts
      presentationContracts.ts
      interactionReplyHelpers.ts
      notificationEmbeds.ts
      paginationControls.ts
      gameLookupCache.ts
      gameStatusEmbeds.ts
    command-registry/
    command-runtime/
    command-snooze/
    command-security/
    notifications/
      deadLetter.ts
      deadLetterRepository.ts
      discountNotificationRuntime.ts
      discountNotificationService.ts
      index.ts
      notificationOutbox.ts
      notificationRuntimeContracts.ts
      notificationTypes.ts
      outboxRuntimeFactory.ts
      seenRuntimeFactory.ts
      updateNotificationRuntime.ts
      youtubeNotificationRuntime.ts
      outboxDedupe.ts
      outboxDeliveryFinalizer.ts
      outboxRepository.ts
      outboxStateMachine.ts
      outboxTypes.ts
      outboundChannel.ts
      seenRepository.ts
      updateNotificationService.ts
    youtube/
      youtubeDeliveryPolicy.ts
      youtubeNotificationService.ts
      youtubeRepository.ts
      youtubeSource.ts
      youtubeTypes.ts
  infra/
    http/
    mongo/
      models.ts
      modelTypes.ts
      guildNotificationSchemas.ts
      guildYoutubeSchemas.ts
      guildAdminRecordSchemas.ts
      auditLogSchemas.ts
      configBackupSchemas.ts
      suggestedCommandSchemas.ts
      youtubeErrorLogSchemas.ts
      operationalSchemas.ts
      seenSchemas.ts
      outboxSchemas.ts
  native/
    fuzzy.ts
    fuzzyNativeBridge.ts
    fuzzyFallbacks.ts
    fuzzyFallbackMetrics.ts
    src/lib.rs
    core/src/
      lib.rs
      types.rs
      text.rs
      hashing.rs
      deals.rs
      updates.rs
      autocomplete.rs
      listing_rank.rs
      fuzzy.rs
  shared/
  sources/
    deals/
      index.ts
      dealHelpers.ts
      steamDeals.ts
      epicDeals.ts
      dealEnrichment.ts
    steam/
    updates/
      index.ts
      updatesContracts.ts
      updatesSourceDispatch.ts
      updatesCircuitBreaker.ts
      updatesFetchOrchestrator.ts
      updateHelpers.ts
      steamUpdates.ts
      listingUpdates.ts
      driverUpdates.ts
      platformUpdates.ts
    sourceRegistry.ts
    sourceTypes.ts
  test/
```

## Comenzi si interactiuni

Routing-ul interactiunilor e compus de `commandRegistry` ca o **lista tipata `CommandHandler[]`**: fiecare handler expune `buildCommandHandler(ctx): CommandHandler` (`{ canHandle, handle }`), iar `dispatchCommand` itereaza lista si deleaga la primul `canHandle` adevarat (fallback-ul, mereu `canHandle: () => true`, e ultimul). Comenzile admin (`start`/`stop`/`set`/`watchlist`/`snooze`/`unsnooze`/`backup`/`bot-log`/`server-log`/`outbox`/`health`/`config`/`reset-config`/`admin-alerts`/`price-alert`/`future-release`/`maintenance`/`sources`/`youtube`/`admin-command-access`/`delete`) trec intai printr-un pre-check `requireGuildAdmin`, care accepta implicit `Administrator`, apoi regula dedicata comenzii din `adminCommandAccessByCommand`, apoi fallback-ul global `adminCommandAccess` configurat de owner, apoi codul global de acces introdus prin modal ephemeral si scrie rezultatul in colectia `guildAuditLogs`; comenzile sensibile pot cere si user ID in `BOT_SENSITIVE_USER_IDS`. Scope-ul dedicat pentru perechile `start`/`stop` este comun pe modul, deci `/start player-count` si `/stop player-count` citesc aceeasi regula. Apoi `commandSnoozeGuard` blocheaza comenzile puse temporar pe pauza inainte de `dispatchCommand`. `handleInteraction`-ul exportat de registru (= pre-check admin + snooze guard + `dispatchCommand`) e punctul de intrare folosit de `app/lifecycle/events.ts`. Nu mai exista un lant de `attachX` care impacheteaza `handleInteraction` si nici un fisier `interactions.ts` separat. Logica concreta sta in handler-e dedicate:

- `simpleCommandsHandler.ts` - comenzi simple precum ping/games;
- `helpInteractionHandler.ts` - paginare si continut pentru help;
- `subscriptionNotificationHandlers.ts` - start/stop pentru update-uri, reduceri, player-count si configurarea canalului DLC;
- `gameFilterHandlers.ts` - filtre si validari pentru jocuri, inclusiv `/set games` si `/watchlist`;
- `rolePingHandlers.ts` - roluri pentru ping-uri;
- `setInteractionHandler.ts` - subcomenzile `/set`; la `/set outbox-recovery-verify on` verifica preventiv permisiunea Read Message History pe canalele de notificari (via `checkReadMessageHistory` din runtime) si avertizeaza daca lipseste; construirea planului de update per subcomanda e delegata modulului pur `setUpdatePlan.ts`;
- `setUpdatePlan.ts` - functie pura `buildSetUpdatePlan` care valideaza si mapeaza fiecare subcomanda `/set` la un `SetUpdatePlan` (`updateDoc`/`confirmMsg`/`isFilterChange`/`earlyReply`), fara acces la Mongo/Discord;
- `configInteractionHandler.ts` - `/config`, sumarul setarilor curente ale serverului intr-un embed ephemeral pentru admini; construirea embed-ului e delegata modulului pur `configView.ts`;
- `configView.ts` - functie pura `buildConfigEmbed` care compune embed-ul `/config` (+ helpere + tipul `ConfigEmbed`), fara acces la Mongo/Discord;
- `guildConfigurationAdminHandler.ts` - `/reset-config` si `/admin-alerts`, cu confirmare explicita la reset si verificarea permisiunilor canalului administrativ;
- `adminCommandAccessHandler.ts` - `/set admin-command-access`, `/admin-command-access list` si `/delete admin-command-access`, owner-only, pentru rol exact sau rol egal/mai-mare care poate folosi comenzi admin global sau doar pe o comanda/pachet, pe langa `Administrator` si codul global de acces; perechile `start`/`stop` pentru acelasi modul se normalizeaza la acelasi scope; formatarea mesajelor si normalizarea modului sunt delegate modulului pur `adminCommandAccessViews.ts`;
- `adminCommandAccessViews.ts` - functii pure de prezentare/normalizare pentru accesul admin (`formatCurrentAccess`/`formatAccessList`/`formatScopedAccess` — inclusiv avertismentul de reguli in conflict si fallback-ul global — plus `labelMode`/`normalizeMode` si tipurile `AdminAccessMode`/`GuildAdminAccessDoc`), fara acces la Mongo/Discord;
- `priceAlertInteractionHandler.ts` - `/add price-alert`, `/remove price-alert` si `/price-alert list`, persistenta regulilor joc+prag+valuta si autocomplete pentru joc;
- `backupInteractionHandler.ts` - `/add backup` si `/backup list/preview/load/delete`, backup-uri ale configuratiei botului pentru server, stocate in colectia dedicata `guildConfigBackups` (un backup per nume per guild, cap de 20 cu evictia celor mai vechi), confirmare la load/delete si audit server la schimbari; randarea textelor e delegata modulului pur `backupViews.ts`;
- `backupViews.ts` - functii pure de randare pentru `/backup` (`renderBackupList`/`renderBackupPreview`), fara acces la Mongo/Discord;
- `auditLogInteractionHandler.ts` - `/bot-log recent/older` si `/server-log recent/older`, citire audit admin (`kind: "bot"`) si audit server (`kind: "server"`) din colectia dedicata `guildAuditLogs`;
- `priceCheckInteractionHandler.ts` - `/price-check`, compara pretul Steam cu sursele externe de reduceri deja folosite de bot; comparatia de titluri si construirea embed-ului sunt delegate modulului pur `priceCheckComparison.ts`;
- `priceCheckComparison.ts` - functii pure pentru `/price-check` (`titlesComparable`/`findComparableDeals`/`buildPriceCheckEmbed` + helpere + tipul `SteamPriceData`), fara acces la retea/DI;
- `dealScoreInteractionHandler.ts` - `/deal-score`, scor 1-10 pentru oferte active pe baza reducerii, pretului, semnalelor de calitate/popularitate si magazinului;
- `suggestCommandInteractionHandler.ts` - `/add suggestion` si `/suggest-command list/delete`, propuneri publice de comenzi stocate in colectia dedicata `guildSuggestedCommands` (o sugestie per nume per guild, cap de 100 cu evictia celor mai vechi) si administrare runtime;
- `watchlistGameSuggestionHandler.ts` - `/watchlist-game add/list/delete`, propuneri publice de jocuri pentru watchlist si stergere admin runtime;
- `futureReleaseInteractionHandler.ts` - `/future-release add/list/delete/start/stop`, lista de maxim 20 jocuri viitoare si canalul pentru notificari future-release;
- `maintenanceInteractionHandler.ts` - `/maintenance`, sumar operational pentru surse, outbox, dead-letter, backup-uri, canale si module active;
- `snoozeInteractionHandler.ts` - `/snooze` si `/unsnooze`, cu comanda tinta validata prin catalogul `/help command`;
- `outboxAdminHandler.ts` - comenzile admin `/outbox` (`status`, `deadletters`, `clear-deadletters`, `replay-deadletters`, `retry`, `drain-now`, `pause`, `resume`, `permissions`, `recovery-verify status`) pentru operarea outbox-ului (coada per-guild si globala, dead-letter, reprogramare livrari, pauza/reluare drenare, audit de permisiuni pe canale, stare recovery-verify); protejat de admin guard (`outbox` e in lista de comenzi admin). `pause`/`resume` comuta flagul persistent `outboxPaused` (pe `system_state`, via `getOutboxPaused`/`setOutboxPaused`), pe care worker-ul de drenare il verifica la fiecare tick inainte de a lua lock-ul; `permissions` foloseste `checkChannelPermissions` din runtime (Send Messages / Embed Links / Read Message History) pentru un audit la cerere; `drain-now` verifica acelasi flag de pauza inainte de lock, revendica lock-ul `outbox_drain` (acelasi ca worker-ul) si dreneaza imediat doar daca drenarea nu e pe pauza si lock-ul e liber, altfel raporteaza starea fara drenari concurente;
- `latestInteractionHandler.ts` - `/latest`;
- `dlcInteractionHandler.ts` - `/dlc`; parsarea paginii de magazin Steam e delegata modulului pur `dlcSteamPage.ts`;
- `dlcSteamPage.ts` - functii pure de parsare a paginii Steam (`dlcPageHasAgeGate`/`parseDlcRows`/`dlcPageLooksLikeStorePage`) pe baza unui `CheerioAPI`, fara retea/DI;
- `statusInteractionHandler.ts` - `/status`;
- `sourcesStatusHandler.ts` - `/sources status`, sumarul ultimelor snapshot-uri persistate pentru sursele externe; construirea embed-ului e delegata modulului pur `sourcesStatusView.ts`;
- `sourcesStatusView.ts` - functii pure care transforma snapshot-urile + sumarul de sanatate al surselor in embed-ul de status (`buildSourcesStatusEmbed` + helpere + tipuri), fara acces la Mongo/Discord;
- `youtubeInteractionHandler.ts` - toate comenzile `/youtube`: abonare/dezabonare, canal principal, rute speciale, sablon, filtre, afisare manuala, status, permisiuni si erori;
- `reportInteractionHandler.ts` - `/report submit`, `/report list` si `/report resolve`; `submit` este public, iar `list`/`resolve` au verificare runtime de administrator; embed-urile/textele de raport sunt construite in modulul pur `reportViews.ts`;
- `reportViews.ts` - functii pure de prezentare pentru `/report` (`buildReportConfirmEmbed`/`buildReportAlertBody`/`buildReportListEmbed`) + tipul `ReportRecord`, fara acces la Mongo/Discord;
- `autocompleteInteractionHandler.ts` - autocomplete pentru optiuni (rutare + scoring de referinta + predicatul `acceptsGameOption`); construirea pool-urilor de alegeri care citesc setarile guild-ului e delegata factory-ului `autocompleteChoiceBuilders.ts`;
- `autocompleteChoiceBuilders.ts` - factory `createAutocompleteChoiceBuilders({ logger, getGuildSettings })` cu cele cinci constructoare de alegeri dependente de setarile guild-ului (set-games remove pool, price-alert remove pool, canale/rute/cuvinte-titlu YouTube), best-effort cu fallback la eroare;
- `fallbackInteractionHandler.ts` - fallback de final.

Fiecare handler primeste dependinte explicite si tipate (factory `createX(deps)`) si expune `buildCommandHandler(ctx): CommandHandler`; `commandRegistry` le aseaza intr-o **lista tipata `CommandHandler[]`** rutata de `dispatchCommand` — primul handler cu `canHandle` adevarat trateaza comanda, fallback-ul (mereu `canHandle: () => true`) e ultimul. Predicatele `canHandle` cu forma comuna (chat-input + guild optional + nume comanda [+ grup/subcomanda]) sunt exprimate declarativ prin `command-registry/commandMatch.ts` (`CommandDescriptor` + `matchesCommand`) — toate cele 16 handler-e cu forma comuna deleaga la el; handler-ele cu logica genuin custom (`backup`, `set` cu excluderi, `price-alert`, `game-info`, `simple-commands`, `watchlist`/`set games`) raman pe predicate proprii.

## Notificari

Zona de notificari este impartita astfel:

- `index.ts` instaleaza job-urile si conecteaza serviciile la runtime;
- `updateNotificationService.ts` construieste si trimite notificarile pentru update-uri;
- `discountNotificationService.ts` construieste si trimite notificarile pentru reduceri;
- `priceAlertService.ts` evalueaza regulile de pret peste aceleasi seturi de oferte grupate pe valuta, revendica atomic trecerea sub prag, trimite embed-ul pe canalul de reduceri si rearmeaza regula dupa revenirea pretului peste prag;
- `features/youtube/youtubeSource.ts` rezolva link/handle/channel ID, citeste feed-ul Atom oficial si extrage metadatele necesare filtrelor Shorts/live/premiere/durata;
- `features/youtube/youtubeRepository.ts` gestioneaza baseline-ul mai vechi de o luna, claim/rollback atomic in `guildSeenYoutube`, starea ultimei verificari si rutele invalide; jurnalul de erori YouTube traieste in colectia dedicata `guildYoutubeErrors` prin `youtubeErrorsRepository.ts` (cap 20 per guild cu evictia celor mai vechi, listare/numarare descrescatoare, golire la `clear-errors` si `/reset-config`);
- `features/youtube/youtubeDeliveryPolicy.ts` centralizeaza fereastra recenta, sablonul, filtrul de titlu, rutele si loturile de livrare;
- `features/youtube/youtubeNotificationService.ts` grupeaza abonamentele dupa channel ID, face un singur fetch per canal pe ciclu si livreaza automat sau manual prin aceleasi filtre si rute;
- `outboundChannel.ts` rezolva canalul Discord de trimitere;
- `seenRepository.ts` gestioneaza deduplicarea (claim/rollback/seed) pentru update-uri si reduceri. YouTube foloseste acelasi model operational prin `youtubeRepository.ts`. Starea `seen` traieste exclusiv in colectii dedicate: `guildSeenDiscounts` (index unic `{ guildId, dealHash }`), `guildSeenUpdates` (index unic `{ guildId, gameKey, updateId }`) si `guildSeenYoutube` (index unic `{ guildId, channelId, videoId }`). Campurile vechi `seen` / `seenDiscounts` de pe documentul guild au fost eliminate complet din schema. Claim-ul nu scrie pe documentul guild-ului: guard-ul de abonament este un read, iar singura scriere de dedup este create/upsert-ul atomic in colectia dedicata. La `/start` se seed-uieste baseline-ul complet; la `/youtube subscribe` se seed-uieste numai continutul mai vechi de o luna, iar continutul recent ramane eligibil pana la prima activare. Cron-ul de reduceri pre-filtreaza prin `loadSeenDiscountHashes`, iar pentru update-uri si YouTube claim-ul atomic este verificarea autoritara „deja vazut". Afisarea manuala YouTube revendica implicit (claim) videoclipurile cu destinatie pe care le afiseaza, ca o a doua rulare sa nu le reposteze (cu rollback la esec de livrare); optiunea `repeta:true` forteaza repostarea ignorand claim-ul. Cozile `pending` (`pendingUpdates` / `pendingDiscounts`) raman pe documentul guild-ului si sunt reconstruite integral in `$set`-ul final al serviciului dupa fiecare ciclu. Hash-urile de dedup (`dealHash`, `stableUpdateId`) folosesc SHA-256, versionat prin `HASH_VERSION` din `native/fuzzy.ts`; YouTube foloseste identitatea stabila nativa a videoclipului (`videoId`);
- `deadLetter.ts` defineste forma intrarii dead-letter si plafonul cozii; `deadLetterRepository.ts` detine colectia dedicata `guildDeadLetters` (`recordDeadLetters` cu evictia celor mai vechi intrari peste capul de 50 per guild, `listDeadLetters`/`countDeadLetters` descrescator dupa `failedAt`, `clearDeadLetters` si `deleteDeadLettersByDedupeKeys` pentru curatarea dupa replay);
- `notificationOutbox.ts` este un outbox optional (`NOTIFICATION_OUTBOX_ENABLED`, implicit oprit). Cand e activ, `outboundChannel.ts` intoarce un canal al carui `send` pune mesajul ca job in colectia `notificationOutbox` (dupa claim-ul `seen`, deci fara duplicate), iar logica `drainOutbox` il trimite cu rate limit, reincearca cu backoff la erori tranzitorii si il trece in dead-letter la epuizare/erori permanente. Decupleaza sendul de detectie si supravietuieste caderii Discord (joburile sunt persistente). Drenarea este facuta de un worker dedicat (`app/scheduler/outboxWorker.ts`, `createOutboxWorker`) care ruleaza pe propriul interval (`NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS`, implicit 15s), nu legat de cadenta cron-ului, sub un lock Mongo dedicat (`outbox_drain`) pentru a evita trimiterile duble intre instante; porneste in handler-ul `ready` (doar cand outbox-ul e activ) si se opreste la shutdown. TTL-ul lock-ului se auto-dimensioneaza din `NOTIFICATION_OUTBOX_DRAIN_LIMIT` (configurabil) si bugetul de trimitere Discord, ca un drain mare sa nu expire lock-ul (override prin `NOTIFICATION_OUTBOX_LOCK_TTL_MS`). Drenarea revendica fiecare job printr-un lease atomic (`findOneAndUpdate` care seteaza `lockedUntil` / `lockedBy`) inainte de livrare, deci doua drenari suprapuse nu pot trimite acelasi job de doua ori, independent de TTL-ul lock-ului. In plus, fiecare job are un `dedupeKey` stabil (SHA-256 peste un payload normalizat cu chei sortate) si exista un istoric scurt de livrari (`notificationOutboxSent`, unic pe `dedupeKey`, TTL configurabil prin `NOTIFICATION_OUTBOX_SENT_TTL_HOURS`, implicit 24h): `enqueueOutbox` sare daca acel `dedupeKey` a fost deja livrat recent (idempotent), iar la drenare un job cu `dedupeKey` deja in istoric este sters fara re-trimitere (recovery dupa crash intre send si delete). In plus, colectia `notificationOutbox` are un index unic *sparse* pe `dedupeKey`, iar `enqueueOutbox` prinde eroarea `E11000` si nu creeaza un al doilea job pending cu acelasi continut (dedupe la nivel de coada, nu doar pe livrarile deja facute); alte erori se propaga. Drenarea prinde fiecare livrare individual (`try/catch` in jurul lui `deliver`): o exceptie la un job e tratata ca esec tranzitoriu (retry/dead-letter) fara sa opreasca restul ciclului; timpul e proaspat per job (backoff/vechime corecte la drenari lungi); backoff-ul de reincercare are jitter + plafon (`min(backoffMs*attempts, 30min)` x `0.5..1.5`). Lease-ul de claim (`lockedUntil`) deriva din `now`-ul injectat in `drainOutbox` (`now.getTime() + leaseMs`), nu din `Date.now()`, ca sa fie consistent cu ceasul de test/abort. Stergerea job-urilor dupa procesare trece prin helper-ul intern `deleteJob`, care prinde erorile de `deleteOne` si le numara in `deleteFailures` in loc sa abandoneze tot ciclul: un Mongo cazut la stergere nu mai face `drainOutbox` sa arunce (worker-ul tot inregistreaza rezultatul partial al ciclului), job-ul ramane in coada si e dedus/reluat la urmatorul ciclu, iar worker-ul ridica admin alert-ul `outbox:delete`. Si sweep-ul TTL (stergerea job-urilor prea vechi, care foloseste un filtru suplimentar `leaseFree`) numara la fel esecurile de stergere in `deleteFailures` printr-un `try/catch` dedicat, deci o cadere Mongo in sweep nu mai e inghitita silentios (`deletedCount: 0`), ci alimenteaza acelasi contor/alerta. Sweep-ul scrie audit-ul dead-letter (`expired-near-ttl`) **inainte** de `deleteOne` (la fel ca bucla principala), nu dupa: daca stergerea esueaza dupa o scriere reusita de audit, jobul ramane in coada si e reluat, dar payload-ul de audit/replay nu se mai pierde (`expired++` ramane gated pe `deletedCount > 0`). In plus, **stergerea unui job ne-livrat se face doar daca scrierea auditului a reusit, pe toate caile terminale**: cele doua cai de expirare (bucla principala + sweep) **si** esecul terminal de livrare (`permanent` / `max-attempts`) trec prin helper-ul `recordDeadLetterOrKeep(job, reason)`, iar daca `recordDeadLetter` arunca, jobul **NU** mai e sters (ramane in coada, reluat la urmatorul ciclu; la `permanent`/`max-attempts` ramane terminal, deci re-revendicarea doar reincearca auditul, nu produce livrari noi), esecul e numarat in `deadLetterFailures`, iar worker-ul ridica admin alert-ul `outbox:deadletter-write` — asa un esec de scriere a auditului nu mai poate duce la pierderea jobului fara payload de replay. Singura cale ramasa intentionat pe stergere neconditionata e `delivered-marksent-failed`: mesajul a fost deja trimis, deci pastrarea jobului ar produce un duplicat. Pe aceasta cale, esecul scrierii auditului **nu mai e silentios**: trece prin helper-ul `recordDeadLetterBeforeDelete`, care incrementeaza `deadLetterFailures` (ridicand `outbox:deadletter-write`) si logheaza un WARN dedicat, dar **tot sterge** jobul — asa operatorul afla de cazul riscant de dedupe-degradat (coreleaza cu `bot_outbox_mark_sent_failures`), fara sa rastorne garantia anti-duplicat. Marcarea „trimis" ruleaza prin `withMongoRetry` si intoarce un boolean; daca tot esueaza dupa o livrare reusita, jobul deja livrat este sters, se scrie audit dead-letter cu motivul `delivered-marksent-failed`, se incrementeaza `bot_outbox_mark_sent_failures`, iar drain-ul curent se opreste dupa acel job ca sa nu continue trimiteri noi cat timp istoricul de dedupe este degradat. Optional (`NOTIFICATION_OUTBOX_RECOVERY_VERIFY=true`, implicit oprit, configurabil si per-guild prin comanda admin `/set outbox-recovery-verify <on|off>`, care scrie `GuildSettings.outboxRecoveryVerify`), embed-urile primesc un marker `dedupeKey` in footer, iar un job re-revendicat (`deliveries > 1`) verifica ultimele mesaje din canal pentru acel marker inainte de a re-trimite — folosind Discord ca sursa de adevar pentru fereastra `send` -> `markSent`. Optional, `NOTIFICATION_OUTBOX_RECOVERY_STRICT=true` (implicit oprit) schimba comportamentul cand fetch-ul de istoric esueaza: in loc de fail-open (trimite oricum), face fail-closed — nu trimite, reprogrameaza jobul cu backoff si numara `recoveryFailures` (care declanseaza admin alert-ul), pentru servere unde duplicatele sunt foarte grave. Logica de livrare (inclusiv verificarea pe istoric) sta in `outboxDelivery.ts` (`createOutboxDelivery`), testabila izolat, iar rezultatele alimenteaza metrici la `/metrics` (`bot_outbox_recovery_duplicates_prevented` / `bot_outbox_recovery_history_fetches` / `bot_outbox_recovery_verify_failures` / `bot_outbox_recovery_marker_missing`). Campul `recoveryVerify` este declarat in schema outbox (altfel strict mode l-ar sterge), iar numarul de mesaje scanate la verificare este configurabil prin `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` (implicit 25). Discord nu permite exact-once real, dar lease-ul + istoricul reduc fereastra de duplicare la intervalul dintre trimiterea pe Discord si scrierea in istoric. Worker-ul alimenteaza metrici Prometheus la `/metrics` din rezultatul fiecarui drain: `bot_outbox_sent` / `bot_outbox_retried` / `bot_outbox_dead_lettered` / `bot_outbox_drains` / `bot_outbox_lock_acquire_failures` (countere), `bot_outbox_delivery_ms_total` (latenta cumulata) si `bot_outbox_queue_depth` / `bot_outbox_oldest_job_age_seconds` (gauge-uri pentru backlog), plus `bot_outbox_mark_sent_failures` (livrari care nu au putut fi inregistrate in istoricul de dedupe). Cand un drain raporteaza esecuri, worker-ul trimite si un admin alert cu cooldown per-tip: `outbox:recovery-read` cand `recoveryFailures > 0` (lipseste permisiunea Read Message History), `outbox:mark-sent` cand `markSentFailures > 0` (risc de duplicare la recovery), `outbox:delete` cand `deleteFailures > 0` (job-uri procesate care nu s-au putut sterge din coada) si `outbox:deadletter-write` cand `deadLetterFailures > 0` (auditul dead-letter la expirare a esuat, deci job-urile nu au fost sterse), ca operatorul sa afle proactiv, nu doar din metrici. In plus, gauge-ul `bot_outbox_recovery_verify_enabled_guilds` (refresh-uit la fiecare drain din `countDocuments`) arata cate servere au activat protectia maxima per-guild.
- La drain, verificarea abonarii pe guild/canal este fail-closed la eroare Mongo: daca `isStillSubscribed` nu poate confirma abonarea, jobul se reprogrameaza cu backoff si nu se livreaza, ca sa nu trimita intr-un canal dezabonat sau reconfigurat.

Aceasta impartire reduce riscul de copy-paste in cron jobs si permite teste functionale mai clare.

Trimiterea catre Discord se face grupat: serviciile claim-uiesc itemii (`seen`) intr-o faza, apoi trimit pana la 10 embed-uri per mesaj (limita Discord), in pachete de pana la `MAX_UPDATES_PER_CYCLE` / `MAX_DEALS_PER_CYCLE`; YouTube foloseste maximum 5 videoclipuri per mesaj si asteapta 10 minute intre loturile suplimentare. Asta scade numarul de request-uri Discord si presiunea pe rate limit. Daca un mesaj esueaza, pachetul lui se face rollback si re-coadeaza (sau dead-letter la epuizare), iar ping-ul de rol apare doar pe primul mesaj.

Cand o livrare (update sau reducere) epuizeaza toate reincercarile (`PENDING_UPDATE_MAX_ATTEMPTS` / `PENDING_DISCOUNT_MAX_ATTEMPTS`), item-ul nu mai este aruncat silentios: este persistat ca document in colectia dedicata `guildDeadLetters` (prin `deadLetterRepository.recordDeadLetters`), impreuna cu motivul, numarul de incercari si momentul esecului; scrierea de audit se face DUPA scrierea principala pe guild si doar daca aceasta a gasit documentul (pastrand vechea conditie in care `$push`-ul combinat se aplica doar la match). Coada este plafonata la ultimele `NOTIFICATION_DEAD_LETTER_LIMIT` intrari per guild prin evictia celor mai vechi documente, astfel incat colectia nu creste nelimitat. Scopul este vizibilitate asupra livrarilor esuate definitiv si pastrarea informatiei la restart.

Faza de fetch are un event store: dupa fiecare ciclu cron reusit, rezultatele normalizate se persista in DB prin `infra/mongo/fetchSnapshots.ts` (`saveFetchSnapshot`) — cheia `updates` pentru lista completa de update-uri si `deals:<MONEDA>` pentru reduceri. Scrierile sunt best-effort (nu blocheaza cron-ul) si documentele au TTL. La pornire, `app/main.ts` hidrateaza cache-urile in-memory din aceste snapshot-uri (`loadFetchSnapshot` / `loadDealsFetchSnapshots`, expuse setter-ele `setUpdatesCache` / `setDealsCache` prin `commandRegistry`) cand sunt suficient de proaspete, deci comenzile servesc imediat ultimele date dupa restart. Acest store este si baza peste care un dispatcher separat va putea citi evenimentele, decupland fetch-ul de trimitere.

Ca prim pas de decuplare, faza de dispatch foloseste deja event store-ul ca rezerva: daca fetch-ul live esueaza in ciclul cron (`getLatestForAllGames` pentru update-uri sau `fetchDeals` pentru reduceri), dispatch-ul citeste ultimul snapshot persistat (`loadFetchSnapshot`) si continua trimiterile de pe ultimele date bune in loc sa abandoneze ciclul. Snapshot-ul de rezerva este folosit doar daca este proaspat: `fetchedAt` trebuie sa fie sub `SNAPSHOT_FALLBACK_MAX_AGE_MS` (60 de minute); altfel snapshot-ul invechit este ignorat (ciclul de update-uri se opreste, guild-ul de reduceri se sare), ca sa nu se trimita date vechi. Deduplicarea `seen` previne re-trimiterea, iar daca nu exista snapshot proaspat comportamentul ramane cel vechi (abandon/skip).

## Native Rust/N-API

`native/` e un workspace Cargo: logica traieste in crate-ul pur `discord_patch_bot_logic` (`src/native/core/src/lib.rs`, rlib fara napi, cu toate testele unitare — `cargo test -p discord_patch_bot_logic` ruleaza fara build-ul N-API), iar `src/native/src/lib.rs` e doar wrapper-ul cdylib `#[napi]` care deleaga la core. Functiile raman deterministe, fara Discord, Mongo sau HTTP:

- fuzzy matching si Levenshtein;
- normalizare text si titluri;
- `stableUpdateId`, `normalizeDealState` si `dealHash`;
- scoring pentru listing-uri si URL-uri Steam;
- `buildAutocompleteChoices` pentru scoring, sortare si limitare optiuni Discord;
- `dealPassesFilters` pentru filtrarea ofertelor in cron si `/latest reduceri`.

`src/native/fuzzy.ts` ramane adapterul TypeScript cu fallback. Daca addon-ul `.node` nu se incarca, botul continua pe fallback si logheaza explicit problema. Fallback-urile trebuie sa pastreze acelasi comportament observabil ca implementarea Rust; de exemplu `extractDateScore` scaneaza tot URL-ul dupa prima data `YYYY-MM-DD` valida (nu se opreste la prima potrivire de tipar daca aceasta are valori in afara intervalului), pentru ca sortarea candidatilor `listing_based` dupa data sa fie identica indiferent de calea folosita.

## TypeScript strict

Strict-ul e activ **global** prin `strict: true` in `src/tsconfig.json` — `npm run typecheck` verifica tot proiectul. Migrarea incrementala (fostul `tsconfig.strict.json`, un subset cu aceleasi flag-uri) s-a incheiat si fisierul a fost eliminat ca redundant.

Zone deja potrivite pentru strict:

- filtre pure din `src/domain/deals/`;
- repository-ul de seen items;
- serviciile de notificari;
- handler-ele de comenzi extrase;
- utilitarele de health/metrics si config;
- adapterul `src/native/fuzzy.ts`;
- sursele `src/sources/steam`, `src/sources/deals` si `src/sources/updates`;
- testele functionale/E2E si testele directe de shape drift pentru scrapers.

Zone care inca trebuie urmarite:

- installerele `attachCommandCache` si `attachCommandUi` nu mai paseaza toata punga `target` catre factory; construiesc un obiect `deps` explicit, restrans, cu doar cheile declarate (TypeScript impune completitudinea), iar `filters`, `notifications/index`, fallback-ul de interactiuni si `mongoContext` au deja factory-uri explicite;
- toate handler-ele de comenzi (`simpleCommands`, `status`, `autocomplete`, `dlc`, `gameFilter`, `rolePing`, `set`, `subscription`, `help` si fallback) plus agregatorul `latest` primesc acum un `deps` explicit, restrans, in loc de toata punga `target`; la `latest`, tipul `deps` este intersectia explicita a celor patru sub-handlere (`latestUpdates`, `latestDeals`, `latestSingle`, `priceSearch`), fara index signature, asa incat TypeScript impune lista completa de dependinte;
- stratul de wiring nu mai vehiculeaza un singleton mutabil netipat: `commandRuntimeContext.ts` expune acum o factory tipata `createCommandRuntimeContext()` (cu interfata explicita `DiscordRuntimeBindings` pentru constructorii discord.js), iar `commandRegistry.ts` construieste un context proaspat la fiecare apel `createCommandRegistry` in loc sa mute un singleton global comun; asta elimina si riscul de dublare a lantului `handleInteraction` la o eventuala re-rulare;
- mock-urile de test trebuie mentinute pe shape-uri locale mici cand apar fluxuri noi pentru Discord, Mongo sau HTTP.

## Securitate si runtime

- Comenzile administrative trebuie sa aiba atat permisiuni declarate in slash command, cat si verificari runtime in handler.
- Linkurile externe si proxy-urile trebuie validate prin config, iar request-urile HTTP trec prin validare URL si DNS/IP ca protectie SSRF.
- Modulul HTTP din `infra/http` este descompus pe responsabilitati: `client.ts` ramane wiring-ul (agenti keep-alive cu lookup DNS sigur, instanta axios, proxy-uri, helperele native/cheerio si buclele `httpReq`/`fetchWithProxy`), iar logica pura sta in module dedicate, testabile independent — `ssrfGuard.ts` (guard SSRF + DNS-rebinding), `retryPolicy.ts` (clasificarea esecurilor + backoff cu jitter/plafon, `random` injectabil), `proxyTemplates.ts` (rezolvarea/validarea template-elor de proxy), `conditionalCache.ts` (`createConditionalGet` cu cache ETag/Last-Modified LRU si `httpReq` injectat) si `httpMetrics.ts` (counter-ele initiale). Orice logica HTTP pura noua ar trebui adaugata in modulul corespunzator, nu inghesuita in `client.ts`.
- Clientul HTTP expune `conditionalGet(url, parse)`: pentru sursele de update-uri cu un singur fetch direct (Steam, Minecraft, Roblox, Nvidia) tine minte `etag` / `last-modified` per URL si trimite `If-None-Match` / `If-Modified-Since`; pe `304 Not Modified` reuseaza rezultatul parsat anterior, fara redescarcare/reparsare. Surse noi cu fetch unic ar trebui sa foloseasca acelasi helper. Sursele prin proxy nu pot face conditional GET fiindca proxy-ul nu pastreaza header-ele de raspuns.
- `getLatestForAllGames` grupeaza jocurile dupa sursa (`sourceConcurrencyGroup`: steam / epic / listing / driver / other) si ruleaza fiecare grup in paralel cu propria concurrency (`FETCH_CONCURRENCY_STEAM` / `_EPIC` / `_LISTING` / `_DRIVER`, restul pe `FETCH_CONCURRENCY`), ca o sursa lenta sa nu blocheze tot ciclul; rezultatele raman aliniate la ordinea de intrare.
- `/metrics` trebuie protejat cu token cand este expus in afara mediului local.
- Token-urile Discord, URI-urile Mongo si webhook-urile nu trebuie comise.
- Docker trebuie sa ruleze procesul ca user non-root.
- Prezentarea reducerilor trebuie sa fie robusta la date corupte: `validatePendingDiscountSnapshot` ingusteaza snapshot-urile persistate la `ValidatedDealInfo` (cu `title`, `store`, `link`, preturi si `savings` obligatorii), iar `buildDealEmbed` limiteaza procentul afisat la intervalul `[0, 100]`, astfel incat un snapshot `pendingDiscounts` reluat sau alterat sa nu poata produce procente imposibile in embed-uri.

## Teste importante

Ruleaza din `src/`:

```bash
npm test
npm run test:functional
npm run test:e2e
npm run typecheck
npm run build
npm run benchmark
```

`npm run benchmark` (`scripts/notificationBenchmark.ts`) ruleaza un ciclu de update-uri si unul de reduceri pentru 100/500/1000 de guild-uri (sau `BENCHMARK_GUILDS`) cu dependinte care numara I/O-ul, si raporteaza durata, trimiterile Discord, write-urile Mongo si fetch-urile per dimensiune; util pentru a vedea cum scaleaza un ciclu cron.

Teste relevante pentru structura actuala:

- `simpleCommandsHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `updateNotificationService.functional.test.ts` si `discountNotificationService.functional.test.ts` (helpers partajate in `notificationServiceTestKit.ts`);
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`;
- `sourceScraperShapeDrift.test.ts`;
- testele E2E pentru update-uri si reduceri.

## Zone ramase de curatat

- Contextul comun din runtime si registry a fost restrans: factory-urile si handler-ele primesc `deps` explicit, iar `commandRuntimeContext` este o factory tipata consumata de `commandRegistry` cu context proaspat per apel. Daca apar module noi de comenzi, ele trebuie sa pastreze acelasi model (factory cu `deps` explicit, fara sa citeasca direct din punga comuna).
- Mentinerea testelor fara tipuri wildcard nesigure sau abrevieri legacy de context cand se adauga mock-uri noi.
- Mutarea oricarei logici ramase in adaptere catre servicii sau handler-e dedicate.
- Mentinerea documentatiei sincronizate la fiecare schimbare de cod.
