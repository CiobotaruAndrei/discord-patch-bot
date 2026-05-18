# Function map curat

Acest fisier documenteaza functiile importante din repo, pe fisiere. Scopul lui este sa ajute un developer sau un AI sa inteleaga rapid responsabilitatile fiecarui modul fara sa citeasca tot codul de la zero.

## Conventii generale

- Proiectul foloseste build TypeScript catre `dist/`.
- Codul runtime este mixt: JavaScript CommonJS plus module TypeScript compilate.
- Modulele convertite la TypeScript sunt compilate in `dist/` inainte de rulare.
- `src/infra/mongo/index.js`, `src/sources/index.js` si `src/features/commands/index.js` sunt agregatoare.
- `src/types.ts` descrie tipurile folosite in JSDoc si TypeScript, inclusiv contracte pentru config, lifecycle, health, locks, env, logging, shared domain, utilitare, HTTP, Mongo helpers si Steam helpers.
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

### `src/types.ts`

Rol: contracte comune pentru module TypeScript si JSDoc.

Tipuri importante:

- `RuntimeEnv`;
- `LoggerFunction`, `ParseEnvNumber`, `ParseEnvNumberLimits` si `RequestContextStore`;
- `CurrencyConfig`, `CurrencyCode`, `CurrencyPlacement` si `PriceValue`;
- `BotConfig`, `GameConfig` si `ConfigLoadResult`;
- `BotMetrics`;
- `CronController` si `CronHealthSnapshot`;
- `LifecycleState`;
- `RateLimitBucket` si `RateLimiter`;
- `LockToken` si `ActiveLocks`;
- `DealInfo`, `PendingUpdate`, `PendingDiscount`, `GuildSettings`, `SystemTimes` si `SteamSearchItem`;
- `HttpRequestOptions`, cache-uri si rezultate concurente.

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

Comportament:

- limiteaza request-urile la `/health`, `/healthz` si `/metrics` prin token bucket pe IP;
- citeste `x-forwarded-for` cand este string sau array;
- contorizeaza drop-urile in `metrics.httpRateLimitDrops`;
- curata bucket-urile vechi si limiteaza dimensiunea hartii interne.

### `src/app/health/httpServer.ts`

Functii:

- `createHttpServer(...)`;
- `timingSafeEqualStr(crypto, a, b)`.

Comportament:

- aplica rate limiter-ul pe `/health`, `/healthz` si `/metrics`;
- `/health` si `/healthz` returneaza starea Mongo, Discord, uptime si `cronHealth` cand este disponibil;
- `/metrics` verifica `METRICS_TOKEN` cu comparatie timing-safe;
- `/metrics` include `bot_cron_skipped_due_to_health`;
- endpoint-urile necunoscute returneaza `404`.

### `src/app/scheduler/cron.ts`

Rol: controller TypeScript pentru cron-ul automat.

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
- prinde erorile de `acquireDbLock`, le contorizeaza, le adauga in health window si programeaza urmatorul ciclu;
- expune snapshot-ul de health pentru endpoint-ul HTTP.

### `src/app/scheduler/housekeeping.ts`

Functii:

- `createHousekeeping(...)`.

Comportament:

- ruleaza cleanup periodic pentru cache-uri, guild cache, enriched cache si rate limiter;
- expune `start()` si `stop()` pentru lifecycle/shutdown.

### `src/app/lifecycle/events.ts`

Functii:

- `registerDiscordEvents`;
- `registerMongoEvents`.

Comportament:

- la `ready`, inregistreaza slash commands, porneste housekeeping si programeaza cron-ul;
- pune fiecare interactiune Discord intr-un `requestContext` cu `requestId`;
- logheaza erorile Discord si MongoDB.

### `src/app/lifecycle/shutdown.ts`

Functii:

- `createShutdownController(...)`;
- `shutdown(signal, exitCode)`;
- `handleFatalProcessError(kind, reason)`;
- `registerProcessHandlers`.

Comportament:

- opreste cron-ul si housekeeping-ul;
- elibereaza lock-urile active;
- respecta `SHUTDOWN_DRAIN_MS`;
- inchide clientul Discord, conexiunea Mongo si serverul HTTP;
- trimite alerta admin pentru erori fatale de proces.

## Config

### `src/config/configLoader.ts`

Functii:

- `resolveConfigPath(configPath)`;
- `loadConfig(configPath)`.

Comportament:

- rezolva calea config-ului relativ la `process.cwd()`;
- incarca JSON-ul prin `require`;
- valideaza prin `validateConfig`;
- opreste procesul cu mesaj explicit daca fisierul lipseste, JSON-ul este invalid sau lista `games` este goala.

### `src/config/configValidator.ts`

Functii si constante:

- `ALLOWED_GAME_TYPES`;
- `ALLOWED_CHECK_INTERVAL_MINUTES`;
- `GameSchema`;
- `ConfigSchema`;
- `formatZodIssues(issues)`;
- `validateConfig(config, source)`.

Validari speciale:

- duplicate de key/name/aliases;
- Steam fara `appId` sau cu `appId` non-numeric;
- `listing_based` fara URL/base URL;
- Intel fara `url`;
- `upCRD` folosit pe alt tip decat NVIDIA;
- regex invalid in `articleHrefRegex`.

## Shared

### `src/shared/logging.ts`

Functii:

- `attachLogging(ctx)`;
- `logger(level, context, message, meta)`;
- `parseEnvNumber(name, defaultValue, limits)`;
- `getAbortSignal()`.

Include `requestContext` bazat pe `AsyncLocalStorage`, `LOG_SAMPLE_RATE` pentru sampling pe INFO/DEBUG si contracte TypeScript pentru logger, parser numeric de env si contextul cererii.

### `src/shared/env.ts`

Rol: valideaza env-ul si construieste obiectul central `env` tipat ca `RuntimeEnv`.

Functii:

- `attachEnv(ctx)`;
- validarea Zod pentru env-ul brut;
- constructia obiectului `env` folosit de restul runtime-ului.

Atentie:

- in production cere `METRICS_TOKEN` sau `METRICS_PUBLIC=true`;
- placeholder-ul `change_me_to_a_long_random_value` este tratat ca token lipsa;
- foloseste `parseEnvNumber` pentru praguri si limite numerice;
- include pragurile pentru health backoff, retry Mongo, limita LRU pentru cache-ul de reduceri pe valute si limitele HTTP rate limiter-ului.

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

`withMongoRetry` este folosit pentru claim-uri atomice Mongo unde o eroare temporara poate fi reincercata fara sa dubleze notificari.

### `src/shared/errors.ts`

Functii TypeScript:

- `errorMessage(err: unknown): string`;
- `errorDetail(err: unknown): string`.

## Infra Mongo

### `src/infra/mongo/runtime.js`

Expune dependinte comune: `mongoose`, `crypto`, `axios`, `z`, `AsyncLocalStorage`.

### `src/infra/mongo/index.js`

Agregator pentru infrastructura Mongo si shared utilities. Include export pentru `runMigrations`, `ALL_MIGRATIONS`, `getSystemTimes`, `saveSystemTimes`, `withMongoRetry`, `isTransientMongoError`, `getAbortSignal`, guild settings, alerte admin, lock-uri si modelele Mongo.

### `src/infra/mongo/models.js`

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

Comportament:

- creeaza token unic cu `crypto.randomUUID()`;
- accepta lock doar daca documentul expirat sau gol poate fi preluat;
- trateaza duplicate key ca lock indisponibil, nu ca eroare fatala;
- tine `activeLocks` in memorie pentru cleanup la shutdown.

### `src/infra/mongo/migrations.ts`

Functii:

- `attachMigrations(ctx)`;
- `runMigrations(logger)`;
- `ALL_MIGRATIONS`.

Migrari curente:

- `add-enabledStores-to-existing-guilds`;
- `add-maxAbsolutePrice-to-existing-guilds`;
- `add-enabledGames-to-existing-guilds`;
- `trim-runaway-seenDiscounts`.

Rol: ruleaza migrari idempotente la pornire, sub lock distribuit `db_migrations`. State-ul este tinut in colectia `system`, documentul `migrationState`.

### `src/infra/mongo/systemState.ts`

Functii:

- `attachSystemState(ctx)`;
- `getSystemTimes()`;
- `saveSystemTimes(times)`.

Rol: citeste si salveaza timpii globali `all`, `single` si `reduceri` in documentul Mongo `system_state`. Default-ul este `{ all: 35000, single: 2000, reduceri: 10000 }`.

### `src/infra/mongo/guildSettings.ts`

Functii:

- `attachGuildSettings(ctx)`;
- `getGuildSettings(guildId)`;
- `invalidateGuildCache(guildId)`;
- `cleanGuildCache()`;
- `getGuildCacheSize()`.

Comportament:

- cache-uieste setarile de guild pana la `GUILD_CACHE_TTL_MS`;
- invalideaza explicit cache-ul dupa modificari de setari;
- expune dimensiunea cache-ului pentru health/housekeeping.

### `src/infra/mongo/adminAlerts.ts`

Functii:

- `attachAdminAlerts(ctx)`;
- `adminAlert(kind, title, body)`.

Comportament:

- respecta `ADMIN_WEBHOOK_URL` si `ADMIN_ALERT_COOLDOWN_MS`;
- foloseste `AdminAlertCooldownModel` pentru check-and-set atomic intre instante;
- trimite alerta prin webhook Discord si logheaza esecurile fara sa opreasca procesul.

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

### `src/sources/steam/index.ts`

Functii:

- `attachSteam(ctx)`;
- `searchSteamGameByName(query, currencyCode)`;
- `levenshtein(a, b)`;
- `chooseBestSteamMatch(items, query, options)`;
- `fetchSteamPriceDetails(appId, currencyCode)`;
- `extractOfferEndFromHtml(html)`;
- `extractSteamOfferEndDate(appId, currencyCode)`.

Rol: cauta jocuri in Steam Store API, alege match-ul cel mai bun cu penalizari pentru DLC/demo cand utilizatorul cauta jocul principal, citeste detalii de pret si extrage data de expirare a ofertelor din HTML-ul Steam.

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

### `src/features/commands/cache.ts`

Functii: cache runtime, cooldown-uri, `formatUserError`, `canSendEmbeds`, `makeActivationId` si helper-e LRU.

Comportament: cache-ul `dealsByCurrency` este limitat de `DEALS_CURRENCY_CACHE_MAX_SIZE` si reinnoieste cheia accesata pentru comportament LRU.

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
- `getFindGameCacheSize`;
- `clearFindGameCache`;
- `fetchGameStatus`;
- `buildSteamPriceEmbed`.

### `src/features/commands/slashCommands.ts`

Functii:

- `attachSlashCommands(ctx)`;
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

Teste pentru config, regresii comenzi/notificari, hashing, parsing, fuzzy matching, `safeCheerioLoad`, optimizarea cronului, conversia cronului critic la TypeScript, conversia pachetului health la TypeScript, conversia boot/lifecycle/lock la TypeScript, conversia shared env/logging/domain/utilities la TypeScript, conversia Mongo helper/state/migrations la TypeScript, conversia Steam helpers la TypeScript, conversia HTTP client la TypeScript si protectiile portate din codul local.
