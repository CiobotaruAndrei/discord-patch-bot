# Function map curat

Acest fisier documenteaza functiile importante din repo, pe fisiere. Scopul lui este sa ajute un developer sau un AI sa inteleaga rapid responsabilitatile fiecarui modul fara sa citeasca tot codul de la zero.

## Conventii generale

- Proiectul foloseste build TypeScript catre `dist/`.
- Majoritatea modulelor runtime sunt inca JavaScript CommonJS.
- Modulele convertite la TypeScript sunt compilate in `dist/` inainte de rulare.
- `src/infra/mongo/index.js`, `src/sources/index.js` si `src/features/commands/index.js` sunt agregatoare.
- `src/types.ts` descrie tipurile folosite in JSDoc si TypeScript.
- `dist/` este output generat si nu se editeaza manual.
- Singura exceptie intentionata din afara `src/` este `.github/workflows/ci.yml`, necesara pentru GitHub Actions.

## GitHub Actions

### `.github/workflows/ci.yml`

Rol: workflow-ul real de CI pentru GitHub.

Comportament:

- ruleaza pe `push` pe `main` si `codex/**`;
- ruleaza pe `pull_request`;
- poate fi pornit manual din tabul Actions prin `workflow_dispatch`;
- foloseste Node.js 20;
- executa pasii cu `working-directory: src`;
- instaleaza dependintele cu `npm install`;
- seteaza env-uri de test pentru bot;
- ruleaza `npm run check`.

Atentie: GitHub nu ruleaza workflow-uri din `src/.github/workflows`, deci acea copie nu trebuie recreata.

## Build si scripts

### `src/package.json`

Scripturi importante:

- `build`: compileaza cu `tsc` in `dist/`;
- `start`: ruleaza `npm run build && node dist/app/main.js`;
- `typecheck`: ruleaza `tsc --noEmit`;
- `check:config`: compileaza si ruleaza `dist/scripts/check-config.js`;
- `check:syntax`: verifica sintaxa fisierelor `.js` sursa;
- `test`: compileaza si ruleaza testele din `dist/test`;
- `check`: typecheck, build, syntax check, config check si teste.

### `src/tsconfig.json`

Rol:

- compileaza `.ts` si `.js` in `dist/`;
- permite migrare graduala cu `allowJs: true`;
- exclude `dist`, `node_modules` si `coverage`.

## App

### `src/app/main.js`

Rol: entry point-ul botului. Dupa build se ruleaza ca `dist/app/main.js`.

Logica:

- incarca config-ul;
- creeaza metrici;
- creeaza client Discord;
- creeaza rate limiter, housekeeping, cron controller, HTTP server si shutdown controller;
- paseaza cron controller-ul catre HTTP server pentru `cronHealth`;
- conecteaza MongoDB;
- ruleaza `runMigrations(logger)`;
- porneste serverul HTTP;
- face login la Discord.

Atentie: `main.js` ramane orchestrator, nu loc pentru logica mare.

### `src/app/health/metrics.js`

Functii:

- `createMetrics`: creeaza contoare pentru fetch-uri, retry-uri, rate limit, cron, abort, skip-uri cron si uptime.

Tipuri:

- foloseste `BotMetrics` din `src/types.ts` prin JSDoc cu calea `../../types`.

### `src/app/health/rateLimit.js`

Functii:

- `createRateLimiter(env, metrics)`;
- `check(req)`;
- `prune()`;
- `retryAfterSeconds`.

Tipuri:

- foloseste `RateLimitBucket` din `src/types.ts` prin JSDoc cu calea `../../types`.

### `src/app/health/httpServer.js`

Functii:

- `createHttpServer(...)`;
- `timingSafeEqualStr(crypto, a, b)`.

Comportament:

- `/health` si `/healthz` returneaza starea Mongo, Discord, uptime si `cronHealth` cand este disponibil;
- `/metrics` include `bot_cron_skipped_due_to_health` pe langa metricile existente.

### `src/app/scheduler/cron.js`

Functii:

- `createCronController(...)`;
- `recordHealth(success, durationMs)`;
- `shouldSkipForGlobalHealth()`;
- `getHealthSnapshot()`;
- `scheduleNextCron`;
- `runCronCycle`;
- `stop`;
- `shouldAbortCron`.

Comportament:

- foloseste lock distribuit si heartbeat;
- pune `abortSignal` in `requestContext` pentru request-uri HTTP anulabile;
- sare un ciclu cand fereastra globala de health scade sub prag;
- expune snapshot-ul de health pentru endpoint-ul HTTP.

### `src/app/scheduler/housekeeping.js`

Functii:

- `createHousekeeping(...)`.

### `src/app/lifecycle/events.js`

Functii:

- `registerDiscordEvents`;
- `registerMongoEvents`.

### `src/app/lifecycle/shutdown.js`

Functii:

- `createShutdownController(...)`;
- `shutdown(signal, exitCode)`;
- `handleFatalProcessError(kind, reason)`;
- `registerProcessHandlers`.

## Config

### `src/config/configLoader.js`

Functii:

- `resolveConfigPath(configPath)`;
- `loadConfig(configPath)`.

Atentie: la runtime importa validatorul compilat din `dist/config/configValidator.js`.

### `src/config/configValidator.ts`

Rol: validator TypeScript pentru `config.json`, bazat pe Zod.

Functii si constante:

- `ALLOWED_GAME_TYPES`;
- `ALLOWED_CHECK_INTERVAL_MINUTES`;
- `GameSchema`;
- `ConfigSchema`;
- `formatZodIssues(issues)`;
- `validateConfig(config, source)`.

Tipuri interne:

- `IssuePath`;
- `SeenSearchTerm`;
- `ConfigParseError`, folosit pentru acces explicit la `safeParse(...).error.issues` in ramura de eroare.

Validari speciale:

- duplicate de key/name/aliases;
- Steam fara `appId` sau cu `appId` non-numeric;
- `listing_based` fara URL/base URL;
- Intel fara `url`;
- `upCRD` folosit pe alt tip decat NVIDIA;
- regex invalid in `articleHrefRegex`.

## Shared

### `src/shared/logging.js`

Functii:

- `logger(level, context, message, meta)`;
- `parseEnvNumber(name, defaultValue, limits)`;
- `getAbortSignal()`.

Include `LOG_SAMPLE_RATE` pentru sampling pe INFO/DEBUG. WARN si ERROR nu sunt sample-uite. `getAbortSignal` citeste semnalul de anulare din `requestContext`.

### `src/shared/env.js`

Rol: valideaza env-ul si construieste obiectul central `env`.

Atentie:

- in production cere `METRICS_TOKEN` sau `METRICS_PUBLIC=true`;
- placeholder-ul `change_me_to_a_long_random_value` este tratat ca token lipsa;
- include pragurile pentru health backoff, retry Mongo si limita LRU pentru cache-ul de reduceri pe valute.

### `src/shared/domain.js`

Expune:

- `SchemaDriftError`;
- `SUPPORTED_CURRENCIES`;
- `DEFAULT_CURRENCY`;
- `getCurrencyConfig(code)`;
- `formatPrice(value, currencyCode)`.

### `src/shared/utilities.js`

Functii:

- `runConcurrent(items, concurrency, fn, options)`;
- `waitForMongoReady(timeoutMs)`;
- `validatePendingDiscountSnapshot(snapshot)`;
- `isTransientMongoError(err)`;
- `withMongoRetry(fn, options)`.

`withMongoRetry` este folosit pentru claim-uri atomice Mongo unde o eroare temporara poate fi reincercata fara sa dubleze notificari.

### `src/shared/errors.ts`

Functii TypeScript:

- `errorMessage(err: unknown): string`;
- `errorDetail(err: unknown): string`.

## Infra Mongo

### `src/infra/mongo/runtime.js`

Expune dependinte comune: `mongoose`, `crypto`, `axios`, `z`, `AsyncLocalStorage`.

### `src/infra/mongo/index.js`

Agregator pentru infrastructura Mongo si shared utilities. Include export pentru `runMigrations`, `ALL_MIGRATIONS`, `withMongoRetry`, `isTransientMongoError` si `getAbortSignal`.

### `src/infra/mongo/models.js`

Modele:

- `GuildModel`;
- `CircuitBreakerModel`;
- `SystemModel`;
- `JobLockModel`;
- `AdminAlertCooldownModel`.

### `src/infra/mongo/locks.js`

Functii:

- `acquireDbLock(jobName, ttlMs)`;
- `renewDbLock(jobName, token, ttlMs)`;
- `releaseDbLock(jobName, token)`;
- `activeLocks`.

### `src/infra/mongo/migrations.js`

Functii:

- `runMigrations(logger)`;
- `ALL_MIGRATIONS`.

Rol: ruleaza migrari idempotente la pornire, sub lock distribuit `db_migrations`.

### `src/infra/mongo/systemState.js`

Functii:

- `getSystemTimes()`;
- `saveSystemTimes(times)`.

### `src/infra/mongo/guildSettings.js`

Functii:

- `getGuildSettings(guildId)`;
- `invalidateGuildCache(guildId)`;
- `cleanGuildCache()`;
- `getGuildCacheSize()`.

### `src/infra/mongo/adminAlerts.js`

Functii:

- `adminAlert(kind, title, body)`.

## Infra HTTP

### `src/infra/http/client.js`

Functii importante:

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

Atentie: `httpReq` foloseste agenti HTTP/HTTPS keep-alive, citeste `options.signal` sau `getAbortSignal()` si nu face retry pe erori de anulare.

## Sources

### `src/sources/runtime.js`

Expune dependinte pentru surse: `axios`, `cheerio`, `rss-parser`, `crypto` si infrastructura Mongo.

### `src/sources/index.js`

Agregator pentru client HTTP, Steam helpers, update sources si deals sources.

### `src/sources/updates/index.js`

Functii helper:

- `absoluteUrl(base, maybeRelative)`;
- `isGoodSteamArticleUrl(url)`;
- `extractDateScore(url)`;
- `scoreCandidate(candidate, keywords)`;
- `isLikelyPatchNote(item)`.

Fetchers:

- `fetchSteamUpdate(game)`;
- `fetchListingBasedUpdate(game)`;
- `fetchFortniteUpdate()`;
- `fetchAmdUpdate(game)`;
- `fetchIntelUpdate(game)`;
- `fetchMinecraftUpdate()`;
- `fetchRobloxUpdate()`;
- `fetchNvidiaUpdate(game)`;
- `fetchGameUpdate(game)`.

Circuit breaker:

- `executeFetchWithCircuitBreaker(game)`.

Fetch global:

- `_getLatestForAllGamesImpl(games, shouldAbort)`;
- `getLatestForAllGames(games, shouldAbort)`.

`getLatestForAllGames` foloseste cache key bazat pe lista efectiva de jocuri.

### `src/sources/deals/index.js`

Functii:

- `fetchSteamReviewData(appId)`;
- `enrichCacheGet(key, currency)`;
- `enrichCacheSet(key, enriched, currency)`;
- `cleanEnrichedCache()`;
- `getEnrichedCacheSize()`;
- `enrichDealData(deal, currencyCode)`;
- `_fetchDealsImpl(currencyCode)`;
- `fetchDeals(opts)`.

### `src/sources/steam/index.js`

Functii:

- `searchSteamGameByName(query, currencyCode)`;
- `levenshtein(a, b)`;
- `chooseBestSteamMatch(items, query, options)`;
- `fetchSteamPriceDetails(appId, currencyCode)`;
- `extractOfferEndFromHtml(html)`;
- `extractSteamOfferEndDate(appId, currencyCode)`.

## Domain

### `src/domain/deals/filters.js`

Functii:

- `dealPassesFilters(deal, guild)`;
- `normalizePendingUpdateArray(arr)`;
- `normalizePendingDiscountArray(arr)`;
- `toEntries(value)`;
- `mapToObject(map)`;
- `getSeenSet(guild, gameKey)`;
- `rotateAfter(keys, lastKey)`.

## Commands

### `src/features/commands/cache.js`

Functii: cache runtime, cooldown-uri, `formatUserError`, `canSendEmbeds`, `makeActivationId` si helper-e LRU.

Comportament: cache-ul `dealsByCurrency` este limitat de `DEALS_CURRENCY_CACHE_MAX_SIZE` si reinnoieste cheia accesata pentru comportament LRU.

### `src/features/commands/ui.js`

Functii:

- `enforceCooldown`;
- `startCommandLog`;
- `safeDefer`;
- `safeEdit`;
- `buildUpdateEmbed`;
- `buildDealEmbed`;
- `handlePagination`;
- `findGameAndSuggestion`;
- `getFindGameCacheSize`;
- `clearFindGameCache`;
- `fetchGameStatus`;
- `buildSteamPriceEmbed`.

### `src/features/commands/slashCommands.js`

Functii:

- `buildSlashCommandDefinitions()`;
- `registerSlashCommands(token, clientId)`.

### `src/features/commands/interactions.js`

Proceseaza slash commands si autocomplete.

## Notifications

### `src/features/notifications/index.js`

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

Atentie: nu se elimina claim atomic, retry-ul Mongo pentru claim, rollback, pending queues, seen arrays, activation guards, codurile Discord permanente sau limita per ciclu.

## Scripts si teste

### `src/scripts/check-config.js`

Valideaza `config.json`. Este dist-aware: din `dist/scripts` gaseste `src/config.json`.

### `src/scripts/check-syntax.js`

Ruleaza `node --check` pe fisierele `.js` sursa si ignora `dist/`.

### `src/test/*`

Teste pentru config, regresii comenzi/notificari, hashing, parsing, fuzzy matching, `safeCheerioLoad`, optimizarea cronului si protectiile portate din codul local.
