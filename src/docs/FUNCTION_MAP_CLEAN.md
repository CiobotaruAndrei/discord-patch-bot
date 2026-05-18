# Function map curat

Acest fisier documenteaza responsabilitatile modulelor importante din repo. Sursa din `src` este TypeScript; fisierele `.js` apar dupa build in `dist/`.

## Conventii generale

- Proiectul compileaza TypeScript catre `src/dist/`.
- Runtime-ul compilat este CommonJS.
- `src/tsconfig.json` are `allowJs: false`, deci fisierele `.js` nu mai sunt acceptate ca sursa editabila.
- `src/scripts/check-syntax.ts` pica verificarea daca mai apare un fisier `.js` in sursa `src`, ignorand `dist/`.
- `src/infra/mongo/index.ts`, `src/sources/index.ts` si `src/features/commands/index.ts` sunt agregatoare.
- `src/types.ts` tine tipurile comune folosite intre module.
- `src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy dinamice ramase in fisierele mari convertite.
- `dist/` este output generat si nu se editeaza manual.
- Singura exceptie intentionata din afara `src` este `.github/workflows/ci.yml`.

## GitHub Actions

### `.github/workflows/ci.yml`

Rol: workflow-ul real de CI.

Comportament:

- ruleaza pe `push` pe `main` si `codex/**`;
- ruleaza pe `pull_request`;
- poate fi pornit manual prin `workflow_dispatch`;
- foloseste Node.js 20;
- ruleaza cu `working-directory: src`;
- instaleaza dependintele si executa `npm run check`.

## Build si scripts

### `src/package.json`

Scripturi:

- `build`: compileaza cu `tsc`;
- `start`: compileaza si ruleaza `dist/app/main.js`;
- `typecheck`: ruleaza `tsc --noEmit`;
- `check:syntax`: compileaza si ruleaza `dist/scripts/check-syntax.js`;
- `check:config`: compileaza si ruleaza `dist/scripts/check-config.js`;
- `test`: compileaza si ruleaza testele din `dist/test`;
- `check`: ruleaza typecheck, build, syntax check, config check si teste.

### `src/tsconfig.json`

Rol:

- compileaza sursa TypeScript in `dist`;
- pastreaza CommonJS ca format runtime;
- foloseste `moduleDetection: force`, pentru fisiere convertite care inca folosesc `require` si `module.exports`;
- are `allowJs: false` si include doar `**/*.ts` plus `**/*.d.ts`;
- exclude `dist`, `node_modules` si `coverage`.

### `src/types.ts`

Rol: contracte comune pentru config, env, metrics, cron, lifecycle, locks, HTTP, Mongo, surse, comenzi si date de domeniu.

### `src/legacy-dynamic.d.ts`

Rol: compatibilitate temporara pentru obiectele legacy construite dinamic dupa conversia fisierelor mari la TypeScript.

Include declaratii pentru:

- campuri dinamice din `updateDoc`, `sendPayload` si `setDoc`;
- `fetchGameStatus`, folosit de handler-ul legacy de status.

Atentie: acest fisier este o punte de migrare. Codul nou trebuie sa foloseasca tipuri locale explicite, nu sa extinda shim-ul fara motiv.

## App

### `src/app/main.ts`

Rol: entrypoint-ul botului.

Logica:

- incarca config-ul;
- creeaza metrici;
- creeaza client Discord;
- creeaza rate limiter, housekeeping, cron controller, HTTP server si shutdown controller;
- inregistreaza evenimente Discord si Mongo;
- conecteaza MongoDB;
- ruleaza migrarile DB;
- porneste serverul HTTP;
- face login la Discord.

### `src/app/health/metrics.ts`

Functii:

- `createMetrics`: creeaza contoare pentru fetch-uri, retry-uri, rate limit, cron, abort, skip-uri cron si uptime.

### `src/app/health/rateLimit.ts`

Functii:

- `createRateLimiter(env, metrics)`;
- `firstHeaderValue(value)`;
- `check(req)`;
- `prune()`;
- `retryAfterSeconds`.

### `src/app/health/httpServer.ts`

Functii:

- `createHttpServer(...)`;
- `timingSafeEqualStr(crypto, a, b)`.

Comportament: expune `/health`, `/healthz`, `/metrics`, aplica rate limit si protejeaza metrics cu token cand e necesar.

### `src/app/scheduler/cron.ts`

Rol: controller pentru cron-ul automat.

Functii:

- `createCronController(...)`;
- `recordHealth(success, durationMs)`;
- `shouldSkipForGlobalHealth()`;
- `getHealthSnapshot()`;
- `scheduleNextCron`;
- `runCronCycle`;
- `stop`;
- `shouldAbortCron`.

### `src/app/scheduler/housekeeping.ts`

Functii:

- `createHousekeeping(...)`.

Comportament: curata periodic cache-uri, guild cache, enriched cache si rate limiter.

### `src/app/lifecycle/events.ts`

Functii:

- `registerDiscordEvents`;
- `registerMongoEvents`.

### `src/app/lifecycle/shutdown.ts`

Functii:

- `createShutdownController(...)`;
- `shutdown(signal, exitCode)`;
- `handleFatalProcessError(kind, reason)`;
- `registerProcessHandlers`.

## Config

### `src/config/configLoader.ts`

Functii:

- `resolveConfigPath(configPath)`;
- `loadConfig(configPath)`.

### `src/config/configValidator.ts`

Functii si constante:

- `ALLOWED_GAME_TYPES`;
- `ALLOWED_CHECK_INTERVAL_MINUTES`;
- `GameSchema`;
- `ConfigSchema`;
- `formatZodIssues(issues)`;
- `validateConfig(config, source)`.

## Shared

### `src/shared/logging.ts`

Functii:

- `attachLogging(ctx)`;
- `logger(level, context, message, meta)`;
- `parseEnvNumber(name, defaultValue, limits)`;
- `getAbortSignal()`.

### `src/shared/env.ts`

Rol: valideaza env-ul si construieste obiectul `env`.

### `src/shared/domain.ts`

Expune:

- `SchemaDriftError`;
- `SUPPORTED_CURRENCIES`;
- `DEFAULT_CURRENCY`;
- `getCurrencyConfig(code)`;
- `formatPrice(value, currencyCode)`.

### `src/shared/utilities.ts`

Functii:

- `runConcurrent(items, concurrency, fn, options)`;
- `waitForMongoReady(timeoutMs)`;
- `validatePendingDiscountSnapshot(snapshot)`;
- `isTransientMongoError(err)`;
- `withMongoRetry(fn, options)`.

### `src/shared/errors.ts`

Functii:

- `errorMessage(err)`;
- `errorDetail(err)`.

## Infra Mongo

### `src/infra/mongo/runtime.ts`

Expune dependinte comune pentru context: `mongoose`, `crypto`, `axios`, `z`, `AsyncLocalStorage`.

### `src/infra/mongo/index.ts`

Agregator pentru infrastructura Mongo si shared utilities. Exporta logger, env, utilitare, modele, lock-uri, migrari, state global, guild settings, alerte admin, valute si request context.

### `src/infra/mongo/models.ts`

Modele:

- `GuildModel`;
- `CircuitBreakerModel`;
- `SystemModel`;
- `JobLockModel`;
- `AdminAlertCooldownModel`.

### `src/infra/mongo/locks.ts`

Functii:

- `attachLocks(ctx)`;
- `acquireDbLock(jobName, ttlMs)`;
- `renewDbLock(jobName, token, ttlMs)`;
- `releaseDbLock(jobName, token)`;
- `activeLocks`.

### `src/infra/mongo/migrations.ts`

Functii:

- `attachMigrations(ctx)`;
- `runMigrations(logger)`;
- `ALL_MIGRATIONS`.

### `src/infra/mongo/systemState.ts`

Functii:

- `attachSystemState(ctx)`;
- `getSystemTimes()`;
- `saveSystemTimes(times)`.

### `src/infra/mongo/guildSettings.ts`

Functii:

- `attachGuildSettings(ctx)`;
- `getGuildSettings(guildId)`;
- `invalidateGuildCache(guildId)`;
- `cleanGuildCache()`;
- `getGuildCacheSize()`.

### `src/infra/mongo/adminAlerts.ts`

Functii:

- `attachAdminAlerts(ctx)`;
- `adminAlert(kind, title, body)`.

## Infra HTTP

### `src/infra/http/client.ts`

Functii importante:

- `attachHttpClient(ctx)`;
- `attachMetrics(m)`;
- `cleanText(text)`;
- `truncate(str, maxLen)`;
- `normalizeTitleForDedupe(str)`;
- `stableUpdateId(title, link)`;
- `normalizeUpdate(data)`;
- `safeCheerioLoad(html)`;
- `normalizeDealState(deal)`;
- `dealHash(deal)`;
- `httpReq(method, url, options, retries, backoff)`;
- `fetchWithProxy(targetUrl, options)`;
- `withInflightTimeout(promise, label)`;
- `trackInflight(map, key, promise)`.

## Sources

### `src/sources/runtime.ts`

Expune dependinte pentru surse: `axios`, `cheerio`, `rss-parser`, `crypto` si infrastructura Mongo.

### `src/sources/index.ts`

Agregator pentru client HTTP, Steam helpers, update sources si deals sources. Expune si exporturi TypeScript pentru `dealHash`, `extractOfferEndFromHtml`, `safeCheerioLoad` si `MAX_HTML_BYTES`, folosite de testele existente.

### `src/sources/updates/index.ts`

Functii principale:

- `attachUpdates(ctx)`;
- `fetchGameUpdate(game)`;
- `executeFetchWithCircuitBreaker(game)`;
- `getLatestForAllGames(games, shouldAbort)`.

### `src/sources/deals/index.ts`

Functii principale:

- `attachDeals(ctx)`;
- `fetchSteamReviewData(appId)`;
- `enrichDealData(deal, currencyCode)`;
- `fetchDeals(opts)`;
- `cleanEnrichedCache()`;
- `getEnrichedCacheSize()`.

### `src/sources/steam/index.ts`

Functii principale:

- `attachSteam(ctx)`;
- `searchSteamGameByName(query, currencyCode)`;
- `chooseBestSteamMatch(items, query, options)`;
- `fetchSteamPriceDetails(appId, currencyCode)`;
- `extractOfferEndFromHtml(html)`;
- `extractSteamOfferEndDate(appId, currencyCode)`.

## Domain

### `src/domain/deals/filters.ts`

Functii:

- `dealPassesFilters(deal, guild)`;
- `normalizePendingUpdateArray(arr)`;
- `normalizePendingDiscountArray(arr)`;
- `toEntries(value)`;
- `mapToObject(map)`;
- `getSeenSet(guild, gameKey)`;
- `rotateAfter(keys, lastKey)`.

## Commands

### `src/features/commands/index.ts`

Agregator pentru cache, filtre, UI, notificari, slash commands si interactions. Mai seteaza temporar `globalThis.fetchGameStatus` pentru handler-ul legacy convertit la TypeScript.

### `src/features/commands/cache.ts`

Functii: cache runtime, cooldown-uri, `formatUserError`, `canSendEmbeds`, `makeActivationId` si helper-e LRU.

### `src/features/commands/ui.ts`

Functii:

- `enforceCooldown`;
- `startCommandLog`;
- `safeDefer`;
- `safeEdit`;
- `buildUpdateEmbed`;
- `buildDealEmbed`;
- `handlePagination`;
- `findGameAndSuggestion`;
- `fetchGameStatus`;
- `buildSteamPriceEmbed`.

### `src/features/commands/slashCommands.ts`

Functii:

- `attachSlashCommands(ctx)`;
- `buildSlashCommandDefinitions()`;
- `registerSlashCommands(token, clientId)`.

### `src/features/commands/interactions.ts`

Proceseaza slash commands si autocomplete.

Functii principale:

- `handleInteraction(interaction, games)`;
- `handleAutocomplete(interaction, games)`;
- `handleStartInteraction(interaction, games)`;
- `handleStopInteraction(interaction)`;
- `handleSetInteraction(interaction, games)`;
- `handleLatestInteraction(interaction, games)`;
- `handleDlcInteraction(interaction)`;
- `handleStatusInteraction(interaction, games)`;
- `buildHelpEmbed()`.

## Notifications

### `src/features/notifications/index.ts`

Update-uri:

- `DISCORD_PERMANENT_ERROR_CODES`;
- `isPermanentDiscordError`;
- `claimSeenUpdate`;
- `rollbackSeenUpdate`;
- `disableUpdatesForChannelError`;
- `processGuildUpdates`;
- `buildOptimizedGameList`;
- `checkForUpdates`.

Reducerile:

- `claimSeenDiscount`;
- `rollbackSeenDiscount`;
- `disableDiscountsForChannelError`;
- `processGuildDiscounts`;
- `checkForDiscounts`.

Atentie: nu se elimina claim atomic, retry-ul Mongo, rollback-ul, pending queues, activation guards, codurile Discord permanente sau limita per ciclu.

## Scripts si teste

### `src/scripts/check-config.ts`

Valideaza `config.json`. Este dist-aware si gaseste config-ul real cand ruleaza din `dist/scripts`.

### `src/scripts/check-syntax.ts`

Verifica faptul ca nu exista fisiere JavaScript sursa ramase in `src`. Ignora `dist`; daca gaseste un `.js` in sursa, CI pica si listeaza fisierul.

### `src/test/buildOptimizedGameList.test.ts`

Testeaza `buildOptimizedGameList` pentru guild-uri fara filtre, filtre per joc, uniuni intre guild-uri si chei stale.

### `src/test/commands-regression.test.ts`

Testeaza regresiile pentru comenzi, notificari, health, cron, Mongo, HTTP, sources, TypeScript build si protectiile portate din codul local.

### `src/test/configValidator.test.ts`

Testeaza forma acceptata a config-ului si validari pentru intervale, duplicate, Steam app IDs si `upCRD` legacy.

### `src/test/dealHash.test.ts`

Testeaza stabilitatea `dealHash`, inclusiv faptul ca modificarea textului datei de expirare nu creeaza o oferta noua.

### `src/test/extractOfferEndFromHtml.test.ts`

Testeaza parser-ul Steam pentru expresii de tip `Offer ends`, `Sale ends`, `Special promotion ends` si fallback-uri din HTML.

### `src/test/findGameAndSuggestion.test.ts`

Testeaza match-ul exact, aliasurile, fuzzy matching-ul si cache-ul pentru cautarea jocurilor.

### `src/test/safeCheerioLoad.test.ts`

Testeaza incarcarea HTML sigura, taierea la limita de bytes si pastrarea codepoint-urilor UTF-8 valide.
