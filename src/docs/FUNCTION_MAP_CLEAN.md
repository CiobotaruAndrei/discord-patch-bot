# Function map curat

Acest fisier documenteaza functiile importante din repo, pe fisiere. Scopul lui este sa ajute un developer sau un AI sa inteleaga rapid responsabilitatile fiecarui modul fara sa citeasca tot codul de la zero.

## Conventii generale

- Proiectul foloseste CommonJS: `require` si `module.exports`.
- Multe module exporta o functie care primeste `ctx` si ataseaza functii/proprietati pe `ctx`.
- `src/infra/mongo/index.js`, `src/sources/index.js` si `src/features/commands/index.js` sunt agregatoare.
- `src/types.ts` descrie tipurile folosite in JSDoc si TypeScript check.

## App

### `src/app/main.js`

Rol: entry point-ul botului. Leaga modulele principale, porneste MongoDB, ruleaza migrarile, porneste HTTP server-ul si clientul Discord.

Atentie:

- trebuie sa ramana orchestrator;
- cron-ul se porneste dupa ce Discord este ready;
- erorile fatale la boot duc la `process.exit(1)`.

### `src/app/health/metrics.js`

Functii:

- `createMetrics`: creeaza contoare pentru fetch-uri, retry-uri, rate limit, cron, abort si uptime.

### `src/app/health/rateLimit.js`

Functii:

- `createRateLimiter(env, metrics)`: token bucket per IP pentru endpoint-urile HTTP;
- `check(req)`: decide daca request-ul este permis;
- `prune()`: curata bucket-uri vechi;
- `retryAfterSeconds`: valoarea pentru header-ul `Retry-After`.

### `src/app/health/httpServer.js`

Functii:

- `createHttpServer(...)`: creeaza serverul pentru `/health`, `/healthz`, `/metrics`;
- `timingSafeEqualStr(crypto, a, b)`: compara token-ul de metrics fara leak de timing.

Atentie: `/metrics` poate expune informatii operationale si trebuie protejat in production.

### `src/app/scheduler/cron.js`

Functii:

- `createCronController(...)`: configureaza cron-ul principal;
- `scheduleNextCron`: programeaza urmatorul ciclu;
- `runCronCycle`: ia lock-ul `cron_main`, ruleaza update-uri si reduceri, elibereaza lock-ul;
- `stop`: opreste cron-ul curent si timer-ele.

Atentie: nu se elimina lock-ul distribuit si nu se pornesc doua cron-uri simultan.

### `src/app/scheduler/housekeeping.js`

Functii:

- `createHousekeeping(...)`: porneste un interval periodic pentru cache cleanup.

### `src/app/lifecycle/events.js`

Functii:

- `registerDiscordEvents`: ready, interactionCreate, warning/error Discord;
- `registerMongoEvents`: connected, disconnected, error, reconnected.

### `src/app/lifecycle/shutdown.js`

Functii:

- `createShutdownController(...)`;
- `shutdown(signal, exitCode)`;
- `handleFatalProcessError(kind, reason)`;
- `registerProcessHandlers`.

Atentie: shutdown-ul elibereaza lock-urile active si inchide resursele in ordine.

## Config

### `src/config/configLoader.js`

Functii:

- `resolveConfigPath(configPath)`;
- `loadConfig(configPath)`.

### `src/config/configValidator.js`

Functii si constante:

- `ALLOWED_GAME_TYPES`;
- `ALLOWED_CHECK_INTERVAL_MINUTES`;
- `GameSchema`;
- `ConfigSchema`;
- `formatZodIssues(issues)`;
- `validateConfig(config, source)`.

Validari speciale: duplicate de key/name/aliases, Steam fara `appId`, `listing_based` fara URL/base URL, Intel fara `url`, `upCRD` folosit pe alt tip decat NVIDIA, regex invalid.

## Shared

### `src/shared/logging.js`

Functii:

- `logger(level, context, message, meta)`;
- `parseEnvNumber(name, defaultValue, limits)`.

Atentie: nu se logheaza token-uri sau secrete.

### `src/shared/env.js`

Rol: valideaza env-ul si construieste obiectul central `env`.

Atentie: in production cere `METRICS_TOKEN` sau `METRICS_PUBLIC=true`.

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
- `validatePendingDiscountSnapshot(snapshot)`.

### `src/shared/errors.js`

Functii:

- `errorMessage(err)`;
- `errorDetail(err)`.

## Infra Mongo

### `src/infra/mongo/runtime.js`

Expune dependinte comune pentru modulele Mongo: `mongoose`, `crypto`, `axios`, `z`, `AsyncLocalStorage`.

### `src/infra/mongo/index.js`

Agregator pentru infrastructura Mongo si shared utilities.

### `src/infra/mongo/models.js`

Modele:

- `GuildModel`;
- `CircuitBreakerModel`;
- `SystemModel`;
- `JobLockModel`;
- `AdminAlertCooldownModel`.

Atentie: campurile `seen`, `pendingUpdates`, `seenDiscounts` si `pendingDiscounts` sunt critice pentru duplicate prevention.

### `src/infra/mongo/locks.js`

Functii:

- `acquireDbLock(jobName, ttlMs)`;
- `renewDbLock(jobName, token, ttlMs)`;
- `releaseDbLock(jobName, token)`;
- `activeLocks`.

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

### `src/infra/mongo/migrations.js`

Functii:

- `runMigrations(logger)`;
- `ALL_MIGRATIONS`.

Rol: ruleaza migrari idempotente la pornire, sub lock distribuit, si pastreaza `migrationState.lastApplied`.

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

Atentie: `httpReq` este folosit de toate sursele externe.

## Sources

### `src/sources/runtime.js`

Expune dependinte pentru surse: `axios`, `cheerio`, `rss-parser`, `crypto` si infrastructura Mongo.

### `src/sources/index.js`

Agregator pentru client HTTP, update sources, deals sources si Steam helpers.

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

Functii:

- `setGlobalCacheTtl(ms)`;
- `normalizeCurrencyKey(c)`;
- `getUpdatesCacheData()`;
- `setUpdatesCache(data)`;
- `getDealsCacheData(currency)`;
- `setDealsCache(currency, data)`;
- `cacheGetLRU(map, key)`;
- `evictLRU(map, maxSize)`;
- `cacheSetLRU(map, key, data, ttlMs, maxSize)`;
- `checkUserCooldown(userId, command)`;
- `cleanCache()`;
- `getCacheSizes()`;
- `startCacheCleaner()`;
- `formatUserError(err, defaultMsg, errorCode)`;
- `canSendEmbeds(channel, botId)`;
- `makeActivationId()`.

### `src/features/commands/ui.js`

Functii:

- `enforceCooldown(interaction, command)`;
- `startCommandLog(interaction, command, extra)`;
- `safeDefer(interaction, ephemeral)`;
- `safeEdit(interaction, payload)`;
- `buildUpdateEmbed(gameName, latest, mode)`;
- `buildDealEmbed(deal, mode, currency)`;
- `generateSessionId()`;
- `buildPaginationButtons(prefix, sessionId, page, totalPages)`;
- `handlePagination(...)`;
- `findGameAndSuggestion(text, games)`;
- `getFindGameCacheSize()`;
- `clearFindGameCache()`;
- `fetchGameStatus(game)`;
- `buildSteamPriceEmbed(gameData, appId, offerEndDate, currency)`.

### `src/features/commands/slashCommands.js`

Functii:

- `buildSlashCommandDefinitions()`;
- `registerSlashCommands(token, clientId)`.

### `src/features/commands/interactions.js`

Functii principale:

- `handlePingInteraction`;
- `handleGamesInteraction`;
- `handleHelpInteraction`;
- `handleStartInteraction`;
- `handleStopInteraction`;
- `handleSetInteraction`;
- `handleLatestInteraction`;
- `handleDlcInteraction`;
- `handleStatusInteraction`;
- `handleAutocomplete`;
- `buildHelpEmbed`;
- `handleInteraction`.

## Notifications

### `src/features/notifications/index.js`

Update-uri:

- `claimSeenUpdate(guildId, channelId, gameKey, updateId)`;
- `rollbackSeenUpdate(guildId, gameKey, updateId)`;
- `disableUpdatesForChannelError(guildId, channelId, message)`;
- `processGuildUpdates(client, guild, latestResults)`;
- `buildOptimizedGameList(allGames, subscribedGuilds)`;
- `checkForUpdates(client, games, shouldAbort)`.

Reducerile:

- `claimSeenDiscount(guildId, channelId, hash)`;
- `rollbackSeenDiscount(guildId, hash)`;
- `disableDiscountsForChannelError(guildId, channelId, message)`;
- `processGuildDiscounts(client, guild, deals)`;
- `checkForDiscounts(client, shouldAbort)`.

Atentie: acest fisier este sensibil. Nu se elimina claim atomic, rollback, pending queues, seen arrays, activation guards sau limita per ciclu.

## Scripts si teste

### `src/scripts/check-config.js`

Valideaza `config.json` fara sa porneasca bot-ul.

### `src/scripts/check-syntax.js`

Ruleaza `node --check` pe fisierele `.js`.

### `src/test/*`

Acopera validare config, regresii pentru comenzi/notificari si testele functionale pentru hashing, parsing, fuzzy matching, `safeCheerioLoad` si optimizarea cronului.