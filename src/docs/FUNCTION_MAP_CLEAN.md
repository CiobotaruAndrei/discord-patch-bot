# Function map curat

Acest fisier documenteaza responsabilitatile modulelor importante din repo. Sursa din `src` este TypeScript, cu un nucleu Rust in `src/native` pentru algoritmi puri. Fisierele `.js` apar dupa build in `dist/` sau ca loader N-API generat.

## Conventii generale

- Proiectul compileaza Rust nativ si apoi TypeScript catre `src/dist/`.
- Runtime-ul compilat TypeScript este CommonJS.
- `src/package-lock.json` blocheaza versiunile de dependinte, iar CI instaleaza cu `npm ci`.
- `src/tsconfig.json` are `allowJs: false`, `strict: true` si `noImplicitAny: true`, deci fisierele `.js` nu mai sunt acceptate ca sursa editabila si proiectul principal este verificat strict.
- `src/tsconfig.strict.json` ramane ca verificare separata pentru lista explicita de zone stabilizate anterior.
- `src/scripts/check-syntax.ts` pica verificarea daca mai apare un fisier `.js` in sursa `src`, ignorand `dist/` si loader-ul generat `native/index.js`.
- Agregatoarele descriptive sunt `src/infra/mongo/mongoContext.ts`, `src/sources/sourceRegistry.ts` si `src/features/commands/commandRegistry.ts`.
- `src/types.ts` tine tipurile comune folosite intre module.
- `src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy dinamice.
- `src/native` contine cod Rust doar pentru algoritmi puri, nu pentru Discord/Mongo/HTTP.
- `dist/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output generat si nu se editeaza manual.
- Singura exceptie intentionata din afara `src` este `.github/workflows/ci.yml`.

## GitHub Actions

### `.github/workflows/ci.yml`

Rol: workflow-ul real de CI.

Comportament: ruleaza pe push, pull request si `workflow_dispatch`, foloseste Node.js 20, instaleaza Rust stable, lucreaza in `src`, instaleaza dependintele cu `npm ci` si executa `npm run check`.

## Build si scripts

### `src/package.json`

Scripturi importante:

- `build:rust`: compileaza addon-ul Rust prin `napi build --platform --release`.
- `build:ts`: compileaza TypeScript cu `tsc`.
- `build`: ruleaza Rust apoi TypeScript.
- `start`: compileaza si ruleaza `dist/app/main.js`.
- `typecheck`: ruleaza `tsc --noEmit` cu `strict` activ in configuratia principala.
- `typecheck:strict`: ruleaza `tsc -p tsconfig.strict.json` pe lista explicita de fisiere stabilizate.
- `lint`: ruleaza `typecheck` si `typecheck:strict`.
- `check`: ruleaza typecheck normal, typecheck strict separat, build, syntax check, config check si testele.

### `src/package-lock.json`

Rol: lockfile npm pentru instalari reproductibile local si in GitHub Actions.

### `src/tsconfig.json`

Compileaza sursa TypeScript in `dist`, pastreaza CommonJS ca format runtime, foloseste `moduleDetection: force`, are `allowJs: false`, `strict: true`, `noImplicitAny: true` si exclude `dist`, `node_modules` si `coverage`.

### `src/tsconfig.strict.json`

Verificare stricta separata pentru lista explicita de fisiere stabilizate anterior: `app/health/httpServer.ts`, `app/scheduler/cron.ts`, `app/scheduler/housekeeping.ts`, `features/commands/commandRegistry.ts`, `infra/http/client.ts`, `shared/errors.ts` si testele directe pentru cron, housekeeping si securitatea clientului HTTP.

### `src/.gitignore`

Ignora output-urile generate local: `dist/`, `node_modules/`, `native/target/`, `native/*.node`, `native/index.js` si `native/index.d.ts`.

## Rust Native

### `src/native/src/lib.rs`

Functii exportate: `levenshtein`, `find_game_keys`, `normalize_title_for_dedupe`, `clean_text`, `classify_patch_note`, `score_listing_candidate`, `is_good_steam_article_url`, `extract_date_score`, `stable_update_id`, `normalize_deal_state` si `deal_hash`.

### `src/native/fuzzy.ts`

Punte TypeScript catre addon-ul Rust. Expune wrapper-ele TypeScript si fallback-uri locale compatibile pentru dezvoltare fara binar `.node`. CI verifica incarcarea Rust prin `src/test/rustFuzzy.test.ts`.

## App

### `src/app/main.ts`

Entrypoint-ul botului. Incarca config-ul, creeaza metrici, client Discord, rate limiter, housekeeping, cron controller, HTTP server si shutdown controller; apoi conecteaza MongoDB, ruleaza migrarile, porneste HTTP si face login la Discord.

### `src/app/health/metrics.ts`

`createMetrics` creeaza contoare pentru fetch-uri, retry-uri, rate limit, cron, abort, skip-uri cron si uptime.

### `src/app/health/rateLimit.ts`

`createRateLimiter`, `firstHeaderValue`, `check`, `prune`, `retryAfterSeconds`.

### `src/app/health/httpServer.ts`

`createHttpServer`, `timingSafeEqualStr` si helper-ul intern `pushMetric`. Expune `/health`, `/healthz`, `/metrics`, aplica rate limit, protejeaza metrics cu token cand e necesar si previne duplicarea accidentala a metricilor Prometheus cu acelasi nume.

### `src/app/scheduler/cron.ts`

`createCronController`, health window, lock distribuit, backoff global, abort signal, scheduling pentru ciclurile cron si curatarea handle-ului programat la `stop()`.

### `src/app/scheduler/housekeeping.ts`

`createHousekeeping`. Curata periodic cache-uri, guild cache, enriched cache si rate limiter. `start()` este idempotent: daca timer-ul exista deja, returneaza fara sa creeze inca un `setInterval`.

### `src/app/lifecycle/events.ts`

`registerDiscordEvents` si `registerMongoEvents`.

### `src/app/lifecycle/shutdown.ts`

`createShutdownController`, `shutdown`, `handleFatalProcessError`, `registerProcessHandlers`. Shutdown-ul asteapta `client.destroy()`.

## Config si shared

### `src/config/configLoader.ts`

`resolveConfigPath`, `loadConfig`.

### `src/config/configValidator.ts`

Schema si validare pentru `config.json`.

### `src/shared/logging.ts`

`attachLogging`, `logger`, `parseEnvNumber`, `getAbortSignal`.

### `src/shared/env.ts`

Valideaza env-ul si construieste obiectul `env`.

### `src/shared/domain.ts`

`SchemaDriftError`, valute suportate, `getCurrencyConfig`, `formatPrice`.

### `src/shared/utilities.ts`

`runConcurrent`, `waitForMongoReady`, `validatePendingDiscountSnapshot`, `isTransientMongoError`, `withMongoRetry`.

### `src/shared/errors.ts`

`errorMessage` si `errorDetail`.

## Infra Mongo

### `src/infra/mongo/runtime.ts`

Dependinte comune pentru context: `mongoose`, `crypto`, `axios`, `z`, `AsyncLocalStorage`.

### `src/infra/mongo/mongoContext.ts`

Agregator pentru infrastructura Mongo si shared utilities. Exporta logger, env, utilitare, modele, lock-uri, migrari, state global, guild settings, alerte admin, valute si request context.

### `src/infra/mongo/models.ts`

Modelele `GuildModel`, `CircuitBreakerModel`, `SystemModel`, `JobLockModel`, `AdminAlertCooldownModel`.

### `src/infra/mongo/locks.ts`

`attachLocks`, `acquireDbLock`, `renewDbLock`, `releaseDbLock`, `activeLocks`.

### `src/infra/mongo/migrations.ts`

`attachMigrations`, `runMigrations`, `ALL_MIGRATIONS`.

### `src/infra/mongo/systemState.ts`

`attachSystemState`, `getSystemTimes`, `saveSystemTimes`.

### `src/infra/mongo/guildSettings.ts`

`attachGuildSettings`, `getGuildSettings`, `invalidateGuildCache`, `cleanGuildCache`, `getGuildCacheSize`.

### `src/infra/mongo/adminAlerts.ts`

`attachAdminAlerts`, `adminAlert`.

## Infra HTTP

### `src/infra/http/client.ts`

`attachHttpClient`, `attachMetrics`, `cleanText`, `truncate`, `normalizeTitleForDedupe`, `stableUpdateId`, `normalizeUpdate`, `safeCheerioLoad`, `normalizeDealState`, `dealHash`, `assertSafeExternalUrl`, `httpReq`, `fetchWithProxy`, `withInflightTimeout`, `trackInflight`.

Normalizarile pure si hash-urile sunt delegate catre `src/native/fuzzy.ts`. URL-urile externe sunt validate inainte de request: doar `http`/`https`, fara credentiale, fara localhost, fara adrese private IPv4 si fara adrese IPv6 locale/private. `PROXY_URLS` trebuie sa contina `{url}` si template-urile sunt validate la atasarea clientului HTTP.

## Sources

### `src/sources/runtime.ts`

Dependinte pentru surse: `axios`, `cheerio`, `rss-parser`, `crypto` si infrastructura Mongo.

### `src/sources/sourceRegistry.ts`

Agregator pentru client HTTP, Steam helpers, update sources si deals sources. Expune si exporturi TypeScript folosite de teste.

### `src/sources/updates/index.ts`

`attachUpdates`, `fetchGameUpdate`, `executeFetchWithCircuitBreaker`, `getLatestForAllGames`. Helperii puri de clasificare si scor URL sunt delegati catre Rust prin `src/native/fuzzy.ts`. Fallback-urile RSS pentru AMD, Intel si Nvidia resping item-urile fara titlu sau cu titlu gol dupa curatare, ca rezultatele invalide sa intre pe fluxul normal de eroare/circuit breaker.

### `src/sources/deals/index.ts`

`attachDeals`, `fetchSteamReviewData`, `enrichDealData`, `fetchDeals`, `cleanEnrichedCache`, `getEnrichedCacheSize`.

### `src/sources/steam/index.ts`

`attachSteam`, `searchSteamGameByName`, `chooseBestSteamMatch`, `fetchSteamPriceDetails`, `extractOfferEndFromHtml`, `extractSteamOfferEndDate`. Scorarea Levenshtein vine din Rust cand addon-ul nativ este disponibil.

## Domain

### `src/domain/deals/filters.ts`

`dealPassesFilters`, normalizari pentru pending arrays, conversii map/object si rotire de cozi.

## Commands

### `src/features/commands/commandRegistry.ts`

Agregator pentru cache, filtre, UI, notificari, slash commands si interactions. `fetchGameStatus` ajunge la `interactions.ts` prin context, nu prin `globalThis`. Registrul declara functiile asteptate din context si foloseste `requireRegistryFunction` ca sa pice devreme daca un modul nu a atasat o dependinta obligatorie.

Pattern-ul legacy `require("./cache")(ctx)` inca exista aici, dar acum are un contract minim explicit. Urmatorul pas mare ar fi factory-uri de tip `createCommandRegistry({ mongo, scrapers, logger, env })`.

### `src/features/commands/cache.ts`

Cache runtime, cooldown-uri, `formatUserError`, `canSendEmbeds`, `makeActivationId` si helper-e LRU.

### `src/features/commands/ui.ts`

Embed-uri, paginare, fuzzy matching, status si pret Steam. `findGameAndSuggestion` foloseste `findGameKeys` din `src/native/fuzzy.ts`, iar `refreshGuard` goleste `findGameCache` cand array-ul `games` se schimba.

### `src/features/commands/slashCommands.ts`

Definitii si inregistrare slash commands.

### `src/features/commands/interactions.ts`

Proceseaza slash commands si autocomplete.

## Notifications

### `src/features/notifications/index.ts`

Update-uri si reduceri automate: claim atomic, rollback, pending queues, activation guards, filtre, coduri Discord permanente si trimitere embed-uri. `resolveOutboundChannel` distinge codurile permanente (10003/10004/50001/50013) de erorile tranzitorii.

## Scripts si teste

### `src/scripts/check-config.ts`

Valideaza `config.json`.

### `src/scripts/check-syntax.ts`

Verifica faptul ca nu exista fisiere JavaScript sursa ramase in `src`.

### `src/test/commands-regression.test.ts`

Testeaza regresiile pentru comenzi, notificari, health, cron, Mongo, HTTP, sources, TypeScript build si protectiile portate din codul local, inclusiv guard-urile RSS pentru drivere fara titlu valid.

### `src/test/cronController.test.ts`

Testeaza comportamental ca `createCronController().stop()` curata handle-ul timerului programat si ramane idempotent daca este apelat de mai multe ori.

### `src/test/housekeeping.test.ts`

Testeaza comportamental ca `createHousekeeping().start()` este idempotent si ca `stop()` curata intervalul creat.

### `src/test/httpClientSecurity.test.ts`

Testeaza `assertSafeExternalUrl`, `httpReq` si `fetchWithProxy`: scheme nesigure, localhost, IPv4/IPv6 local sau privat, credentiale in URL, URL tinta prin proxy si template-uri `PROXY_URLS` fara `{url}`.

### `src/test/resolveOutboundChannel.test.ts`

Testeaza comportamental erorile Discord permanente vs tranzitorii.

### `src/test/rustFuzzy.test.ts`

Testeaza ca addon-ul Rust este incarcat in CI si ca helperii nativi pastreaza contractul existent.

### Alte teste

`buildOptimizedGameList`, `configValidator`, `dealHash`, `extractOfferEndFromHtml`, `findGameAndSuggestion` si `safeCheerioLoad` acopera regulile de domeniu si parser-ele sensibile.
