# Function map curat

Acest fisier documenteaza responsabilitatile modulelor importante din repo. Sursa din `src` este TypeScript, cu un nucleu Rust in `src/native` pentru algoritmi puri. Fisierele `.js` apar dupa build in `dist/` sau ca loader N-API generat.

## Conventii generale

- Proiectul compileaza Rust nativ si apoi TypeScript catre `src/dist/`.
- Runtime-ul compilat TypeScript este CommonJS.
- `src/package-lock.json` blocheaza versiunile de dependinte, iar CI instaleaza cu `npm ci`.
- `src/tsconfig.json` are `allowJs: false`, `strict: true` si `noImplicitAny: true`.
- `src/tsconfig.strict.json` include zone stabilizate explicit, inclusiv `src/domain/deals/filtersCore.ts`, `src/features/notifications/outboundChannel.ts` si testele lor directe.
- `src/scripts/check-syntax.ts` pica verificarea daca mai apare un fisier `.js` in sursa `src`, ignorand `dist/` si loader-ul generat `native/index.js`.
- Agregatoarele descriptive sunt `src/infra/mongo/mongoContext.ts`, `src/sources/sourceRegistry.ts` si `src/features/commands/commandRegistry.ts`.
- `src/types.ts` tine tipurile comune folosite intre module.
- `src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy dinamice.
- `src/native` contine cod Rust doar pentru algoritmi puri, nu pentru Discord/Mongo/HTTP.
- `dist/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output generat si nu se editeaza manual.

## Radacina repo-ului

### `README.md`

Rol: ghid principal pentru setup, env, comenzi, Docker, audit, GHCR release image, security, health/metrics, structura, testare, badge-uri si exemple vizuale de embed-uri.

### `CHANGELOG.md`

Rol: istoric de versiuni si schimbari notabile. Explica folosirea tag-urilor semver `vMAJOR.MINOR.PATCH`, mentioneaza imaginea GHCR si sta ca sursa de note pentru GitHub Release.

### `SECURITY.md`

Rol: politica de raportare privata a vulnerabilitatilor si reguli pentru secret management. Acopera tokenuri Discord, credentiale Mongo, `METRICS_TOKEN`, webhook-uri si proxy URL-uri.

### `LICENSE`

Rol: licenta MIT pentru repo, referita si de badge-ul din README.

### `Dockerfile`

Rol: build multi-stage pentru bot. Stage-ul de build instaleaza dependinte, compileaza Rust/N-API si TypeScript; stage-ul runtime porneste doar `npm start` peste `dist/app/main.js`.

### `docker-compose.yml`

Rol: stack local cu MongoDB si bot. Foloseste `src/.env` pentru tokenurile Discord si seteaza `MONGO_URI` catre serviciul `mongo`.

Comportament important: MongoDB este vizibil doar in reteaua Docker interna prin `expose: 27017`, nu prin `ports: 27017:27017`. Botul publica HTTP doar pe `127.0.0.1:3000`.

### `.dockerignore`

Rol: exclude `node_modules`, `dist`, target-ul Rust, `.env` si fisiere inutile din contextul Docker.

### `docs/assets/*.svg`

Rol: exemple statice pentru embed-urile din README: `/help`, update automat si reducere automata.

## GitHub Actions si mentenanta

### `.github/workflows/ci.yml`

Rol: workflow-ul real de CI.

Comportament: ruleaza pe push, pull request si `workflow_dispatch`, foloseste Node.js 20, instaleaza Rust stable, lucreaza in `src`, instaleaza dependintele cu `npm ci` si executa `npm run check`.

### `.github/workflows/dependency-audit.yml`

Rol: audit periodic si manual pentru dependinte runtime.

Comportament: ruleaza saptamanal si la `workflow_dispatch`, lucreaza in `src`, instaleaza cu `npm ci` si executa `npm audit --omit=dev --audit-level=moderate`.

### `.github/workflows/release.yml`

Rol: release automat pentru tag-uri semver si imagine Docker publicata.

Comportament: ruleaza la tag-uri `v*.*.*` sau manual cu input `tag`, rezolva tag-ul si numele imaginii lowercase, face checkout pe ref-ul de release, instaleaza Node.js 20 si Rust stable, ruleaza `npm ci` si `npm run check` in `src`, construieste `Dockerfile`, publica imaginea in GHCR si creeaza GitHub Release cu `CHANGELOG.md` si release notes generate de GitHub.

Output GHCR:

```text
ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>
ghcr.io/ciobotaruandrei/discord-patch-bot:latest
```

### `.github/dependabot.yml`

Rol: update-uri controlate prin PR pentru dependinte.

Comportament: verifica saptamanal npm din `/src` si GitHub Actions, cu grupuri pentru runtime dependencies, build/types si actions.

## Build si scripts

### `src/package.json`

Scripturi importante:

- `build:rust`: compileaza addon-ul Rust prin `napi build --platform --release`.
- `build:ts`: compileaza TypeScript cu `tsc`.
- `build`: ruleaza Rust apoi TypeScript.
- `start`: porneste doar `dist/app/main.js`; nu mai ruleaza build la runtime.
- `start:build`: ruleaza build + start, util pentru verificare locala rapida.
- `dev`: alias pentru `start:build`.
- `typecheck`: ruleaza `tsc --noEmit` cu `strict` activ in configuratia principala.
- `typecheck:strict`: ruleaza `tsc -p tsconfig.strict.json` pe lista explicita de fisiere stabilizate.
- `lint`: ruleaza `typecheck` si `typecheck:strict`.
- `test`: build + testele Node.
- `audit`: ruleaza `npm audit --omit=dev --audit-level=moderate`.
- `check`: ruleaza typecheck normal, typecheck strict separat, build, syntax check, config check si testele.

### `src/package-lock.json`

Rol: lockfile npm pentru instalari reproductibile local si in GitHub Actions.

### `src/.env.example`

Rol: exemplu de configurare pentru `MONGO_URI`, tokenul Discord, client ID, metrics si tuning runtime. Este impartit pe categorii: runtime, Mongo, Discord, metrics, reverse proxy, admin webhook, proxy URL templates, logging, scraping, Discord throughput, circuit breaker, queues/cache si HTTP rate limit.

### `src/tsconfig.json`

Compileaza sursa TypeScript in `dist`, pastreaza CommonJS ca format runtime, foloseste `moduleDetection: force`, are `allowJs: false`, `strict: true`, `noImplicitAny: true` si exclude `dist`, `node_modules` si `coverage`.

### `src/tsconfig.strict.json`

Verificare stricta separata pentru zone stabilizate explicit: health server, scheduler, `domain/deals/filtersCore.ts`, `features/notifications/outboundChannel.ts`, `commandRegistry`, HTTP client, erori shared si testele directe pentru acele zone.

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

`createHousekeeping`. Curata periodic cache-uri, guild cache, enriched cache si rate limiter. `start()` este idempotent.

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

`attachUpdates`, `fetchGameUpdate`, `executeFetchWithCircuitBreaker`, `getLatestForAllGames`. Helperii puri de clasificare si scor URL sunt delegati catre Rust prin `src/native/fuzzy.ts`.

### `src/sources/deals/index.ts`

`attachDeals`, `fetchSteamReviewData`, `enrichDealData`, `fetchDeals`, `cleanEnrichedCache`, `getEnrichedCacheSize`.

### `src/sources/steam/index.ts`

`attachSteam`, `searchSteamGameByName`, `chooseBestSteamMatch`, `fetchSteamPriceDetails`, `extractOfferEndFromHtml`, `extractSteamOfferEndDate`. Scorarea Levenshtein vine din Rust cand addon-ul nativ este disponibil.

## Domain

### `src/domain/deals/filtersCore.ts`

Core tipat pentru regulile de reduceri. Exporta direct `dealPassesFilters`, `normalizePendingUpdateArray`, `normalizePendingDiscountArray`, `toEntries`, `mapToObject`, `getSeenSet` si `rotateAfter`.

### `src/domain/deals/filters.ts`

Adapter legacy pentru context. Importa functiile din `filtersCore.ts`, le expune ca proprietati pe export si le ataseaza pe `ctx` pentru modulele vechi.

Codul nou trebuie sa importe din `filtersCore.ts`; `filters.ts` ramane doar punte pentru compatibilitate.

## Commands

### `src/features/commands/commandRegistry.ts`

Agregator pentru cache, filtre, UI, notificari, slash commands si interactions. `fetchGameStatus` ajunge la `interactions.ts` prin context, nu prin `globalThis`. Registrul declara functiile asteptate din context si foloseste `requireRegistryFunction` ca sa pice devreme daca un modul nu a atasat o dependinta obligatorie.

Pattern-ul legacy cu module care muta functii pe `ctx` inca exista, dar `createCommandRegistry(baseContext, installers)` permite injectarea explicita a installer-elor si testarea fara side effect global. Urmatorul pas mare ar fi factory-uri de tip `createCommandServices({ mongo, sources, logger, env })`.

### `src/features/commands/cache.ts`

Cache runtime, cooldown-uri, `formatUserError`, `canSendEmbeds`, `makeActivationId` si helper-e LRU.

### `src/features/commands/ui.ts`

Embed-uri, paginare, fuzzy matching, status si pret Steam. `findGameAndSuggestion` foloseste `findGameKeys` din `src/native/fuzzy.ts`, iar `refreshGuard` goleste `findGameCache` cand array-ul `games` se schimba.

### `src/features/commands/slashCommands.ts`

Definitii si inregistrare slash commands.

### `src/features/commands/interactions.ts`

Proceseaza slash commands si autocomplete. `handleSetGames` este acoperit functional pentru add/remove in `src/test/setGamesInteraction.functional.test.ts`. Fluxurile complete `/start updates` si `/start reduceri` sunt acoperite in `src/test/startUpdatesFlow.e2e.test.ts` si `src/test/startDiscountsFlow.e2e.test.ts`, peste `interactions.ts` + `notifications/index.ts`.

## Notifications

### `src/features/notifications/outboundChannel.ts`

Serviciu TypeScript tipat pentru rezolvarea canalului Discord outbound: fetch canal, distinctie erori permanente/tranzitorii, verificare permisiuni embed si dezactivare sigura a canalului cand e cazul.

### `src/features/notifications/index.ts`

Update-uri si reduceri automate: claim atomic, rollback, pending queues, activation guards, filtre si trimitere embed-uri. Foloseste `createOutboundChannelResolver` din `outboundChannel.ts`, dar inca expune functiile pe `ctx` ca adapter legacy.

## Scripts si teste

### `src/scripts/check-config.ts`

Valideaza `config.json`.

### `src/scripts/check-syntax.ts`

Verifica faptul ca nu exista fisiere JavaScript sursa ramase in `src`.

### `src/test/startUpdatesFlow.e2e.test.ts`

Testeaza end-to-end fluxul `/start updates`: baseline-ul initial scrie update-ul vechi in `seen`, cron-ul gaseste update-ul nou, trimite un embed si marcheaza update-ul ca vazut.

### `src/test/startDiscountsFlow.e2e.test.ts`

Testeaza end-to-end fluxul `/start reduceri`: baseline-ul initial scrie hash-ul reducerii vechi in `seenDiscounts`, cron-ul gaseste reducerea noua, trimite un embed si marcheaza deal-ul ca vazut.

### `src/test/commandRegistry.functional.test.ts`

Testeaza functional `createCommandRegistry` cu installer-e mock injectate si verificare de eroare cand lipseste o functie obligatorie.

### `src/test/dealFiltersCore.functional.test.ts`

Testeaza functional `filtersCore` direct: reguli de magazin, pret, discount, free/paid, normalizare pending arrays, conversii map/object si rotire de cozi.

### `src/test/setGamesInteraction.functional.test.ts`

Testeaza functional `/set games add/remove`: update-ul Mongo produs, mesajul de confirmare, invalidarea cache-ului si respingerea cheilor inexistente.

### `src/test/mongoMigrations.functional.test.ts`

Testeaza functional migrarile Mongo cu colectii fake: aplica migrarile, taie `seenDiscounts`, actualizeaza `migrationState` si elibereaza lock-ul.

### `src/test/commands-regression.test.ts`

Testeaza regresiile pentru comenzi, notificari, health, cron, Mongo, HTTP, sources, TypeScript build si protectiile portate din codul local.

### `src/test/cronController.test.ts`

Testeaza comportamental ca `createCronController().stop()` curata handle-ul timerului programat si ramane idempotent.

### `src/test/housekeeping.test.ts`

Testeaza comportamental ca `createHousekeeping().start()` este idempotent si ca `stop()` curata intervalul creat.

### `src/test/httpClientSecurity.test.ts`

Testeaza `assertSafeExternalUrl`, `httpReq` si `fetchWithProxy`: scheme nesigure, localhost, IPv4/IPv6 local sau privat, credentiale in URL, URL tinta prin proxy si template-uri `PROXY_URLS` fara `{url}`.

### `src/test/resolveOutboundChannel.test.ts`

Testeaza direct `outboundChannel.ts`: erorile Discord permanente vs tranzitorii, canal null, permisiuni lipsa si happy path.

### `src/test/rustFuzzy.test.ts`

Testeaza ca addon-ul Rust este incarcat in CI si ca helperii nativi pastreaza contractul existent.
