# Function map curat

Acest fisier documenteaza responsabilitatile modulelor importante din repo. Sursa din `src` este TypeScript, cu un nucleu Rust in `src/native` pentru fuzzy matching, normalizare si hash-uri stabile; fisierele `.js` apar dupa build in `dist/` sau ca loader N-API generat.

## Conventii generale

- Proiectul compileaza Rust nativ si apoi TypeScript catre `src/dist/`.
- Runtime-ul compilat TypeScript este CommonJS.
- `src/tsconfig.json` are `allowJs: false`, deci fisierele `.js` nu mai sunt acceptate ca sursa editabila.
- `src/scripts/check-syntax.ts` pica verificarea daca mai apare un fisier `.js` in sursa `src`, ignorand `dist/` si loader-ul generat `native/index.js`.
- `src/infra/mongo/mongoContext.ts`, `src/sources/sourceRegistry.ts` si `src/features/commands/commandRegistry.ts` sunt agregatoare.
- `src/types.ts` tine tipurile comune folosite intre module.
- `src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy dinamice ramase in fisierele mari convertite.
- `src/native` contine cod Rust doar pentru algoritmi puri, nu pentru Discord/Mongo/HTTP.
- `dist/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output generat si nu se editeaza manual.
- Singura exceptie intentionata din afara `src` este `.github/workflows/ci.yml`.

## GitHub Actions

### `.github/workflows/ci.yml`

Rol: workflow-ul real de CI.

Comportament:

- ruleaza pe `push` pe `main` si `codex/**`;
- ruleaza pe `pull_request`;
- poate fi pornit manual prin `workflow_dispatch`;
- foloseste Node.js 20;
- instaleaza Rust stable;
- ruleaza cu `working-directory: src`;
- instaleaza dependintele si executa `npm run check`.

## Build si scripts

### `src/package.json`

Scripturi:

- `build:rust`: compileaza addon-ul Rust prin `napi build --platform --release`;
- `build:ts`: compileaza TypeScript cu `tsc`;
- `build`: ruleaza `build:rust` apoi `build:ts`;
- `start`: compileaza si ruleaza `dist/app/main.js`;
- `typecheck`: ruleaza `tsc --noEmit`;
- `check:syntax`: compileaza TypeScript si ruleaza `dist/scripts/check-syntax.js`;
- `check:config`: compileaza TypeScript si ruleaza `dist/scripts/check-config.js`;
- `test`: compileaza Rust + TypeScript si ruleaza testele din `dist/test`;
- `check`: ruleaza typecheck, build, syntax check, config check si teste.

### `src/tsconfig.json`

Rol:

- compileaza sursa TypeScript in `dist`;
- pastreaza CommonJS ca format runtime;
- foloseste `moduleDetection: force`, pentru fisiere convertite care inca folosesc `require` si `module.exports`;
- are `allowJs: false` si include doar `**/*.ts` plus `**/*.d.ts`;
- exclude `dist`, `node_modules` si `coverage`.

### `src/.gitignore`

Rol: ignora output-urile generate local: `dist/`, `node_modules/`, `native/target/`, `native/*.node`, `native/index.js` si `native/index.d.ts`.

### `src/types.ts`

Rol: contracte comune pentru config, env, metrics, cron, lifecycle, locks, HTTP, Mongo, surse, comenzi si date de domeniu.

### `src/legacy-dynamic.d.ts`

Rol: compatibilitate temporara pentru obiectele legacy construite dinamic dupa conversia fisierelor mari la TypeScript. Include campuri dinamice din `updateDoc`, `sendPayload` si `setDoc`. Declaratia `fetchGameStatus` a fost scoasa in pasul 9 — handler-ul ia acum functia prin destructure din ctx.

## Rust Native

### `src/native/Cargo.toml`

Rol: defineste crate-ul Rust `discord_patch_bot_core`, compilat ca `cdylib` pentru N-API. Dependintele principale sunt `napi`, `napi-derive` si `sha1`.

### `src/native/build.rs`

Rol: ruleaza setup-ul `napi-build` necesar pentru addon-ul Node nativ.

### `src/native/package.json`

Rol: metadata N-API pentru numele addon-ului si triple-urile de build.

### `src/native/src/lib.rs`

Functii exportate:

- `levenshtein(a, b)`: calculeaza distanta Levenshtein in Rust;
- `find_game_keys(text, games, max_input)`: calculeaza in Rust cheia jocului gasit sau cheia sugestiei;
- `normalize_title_for_dedupe(value)`: normalizeaza titlurile pentru dedupe de reduceri;
- `clean_text(text)`: strip HTML tags, decodeaza entitati `&nbsp;/&amp;/&quot;/&#39;/&apos;/&lt;/&gt;` (case-insensitive, preserva pe cele necunoscute), colapseaza whitespace; folosit de toti scraperii;
- `classify_patch_note(title, contents, tags)`: clasificator boolean al unei stiri Steam — bad-in-title invinge good word, tag `patchnotes`/`update` castiga, altfel match pe good-words; foloseste liste statice;
- `score_listing_candidate(href, text, keywords)`: numara cate keywords din lista apar in `href + text` (lowercase, case-insensitive);
- `is_good_steam_article_url(url)`: filtru per news item Steam (trim + lowercase + starts_with http + reject steamstatic/steamcdn);
- `extract_date_score(url)`: scoreaza ancore listing dupa data din URL (YYYY-MM-DD / YYYY/MM/DD); valideaza leap year si respinge roll-over (Feb 31);
- `stable_update_id(title, link)`: creeaza ID stabil de update din SHA1, taiat la 16 caractere;
- `normalize_deal_state(sale_price, normal_price, savings)`: normalizeaza campurile de pret/procent;
- `deal_hash(store, steam_app_id, id, title, sale_price, normal_price, savings)`: creeaza hash stabil pentru reduceri Steam, Epic si listing-based.

Structuri exportate:

- `GameCandidate`;
- `FuzzyMatchResult`.

### `src/native/fuzzy.ts`

Rol: punte TypeScript catre addon-ul Rust.

Functii:

- `isRustFuzzyAvailable()`;
- `levenshtein(a, b)`;
- `findGameKeys(text, games, maxInput)`;
- `normalizeTitleForDedupe(value)`;
- `cleanText(value)`;
- `classifyPatchNote(title, contents, tags)`;
- `scoreListingCandidate(href, text, keywords)`;
- `isGoodSteamArticleUrl(url)`;
- `extractDateScore(url)`;
- `stableUpdateId(title, link)`;
- `normalizeDealState(deal)`;
- `dealHash(deal)`.

Comportament: incarca fisierul `.node` generat in `src/native`; daca lipseste local, foloseste fallback TypeScript pentru ca dezvoltarea sa ramana posibila. CI verifica insa ca Rust este incarcat.

## App

### `src/app/main.ts`

Rol: entrypoint-ul botului. Incarca config-ul, creeaza metrici, clientul Discord, rate limiter-ul, housekeeping-ul, cron controller-ul, HTTP server-ul si shutdown controller-ul; apoi conecteaza MongoDB, ruleaza migrarile, porneste serverul HTTP si face login la Discord.

### `src/app/health/metrics.ts`

Functii: `createMetrics` creeaza contoare pentru fetch-uri, retry-uri, rate limit, cron, abort, skip-uri cron si uptime.

### `src/app/health/rateLimit.ts`

Functii: `createRateLimiter`, `firstHeaderValue`, `check`, `prune`, `retryAfterSeconds`.

### `src/app/health/httpServer.ts`

Functii: `createHttpServer`, `timingSafeEqualStr`. Expune `/health`, `/healthz`, `/metrics`, aplica rate limit si protejeaza metrics cu token cand e necesar.

### `src/app/scheduler/cron.ts`

Functii: `createCronController`, `recordHealth`, `shouldSkipForGlobalHealth`, `getHealthSnapshot`, `scheduleNextCron`, `runCronCycle`, `stop`, `shouldAbortCron`.

### `src/app/scheduler/housekeeping.ts`

Functii: `createHousekeeping`. Curata periodic cache-uri, guild cache, enriched cache si rate limiter.

### `src/app/lifecycle/events.ts`

Functii: `registerDiscordEvents`, `registerMongoEvents`.

### `src/app/lifecycle/shutdown.ts`

Functii: `createShutdownController`, `shutdown`, `handleFatalProcessError`, `registerProcessHandlers`.

## Config si shared

### `src/config/configLoader.ts`

Functii: `resolveConfigPath`, `loadConfig`.

### `src/config/configValidator.ts`

Functii si constante: `ALLOWED_GAME_TYPES`, `ALLOWED_CHECK_INTERVAL_MINUTES`, `GameSchema`, `ConfigSchema`, `formatZodIssues`, `validateConfig`.

### `src/shared/logging.ts`

Functii: `attachLogging`, `logger`, `parseEnvNumber`, `getAbortSignal`.

### `src/shared/env.ts`

Rol: valideaza env-ul si construieste obiectul `env`.

### `src/shared/domain.ts`

Expune: `SchemaDriftError`, `SUPPORTED_CURRENCIES`, `DEFAULT_CURRENCY`, `getCurrencyConfig`, `formatPrice`.

### `src/shared/utilities.ts`

Functii: `runConcurrent`, `waitForMongoReady`, `validatePendingDiscountSnapshot`, `isTransientMongoError`, `withMongoRetry`.

### `src/shared/errors.ts`

Functii: `errorMessage`, `errorDetail`.

## Infra Mongo

### `src/infra/mongo/runtime.ts`

Expune dependinte comune pentru context: `mongoose`, `crypto`, `axios`, `z`, `AsyncLocalStorage`.

### `src/infra/mongo/mongoContext.ts`

Agregator pentru infrastructura Mongo si shared utilities. Exporta logger, env, utilitare, modele, lock-uri, migrari, state global, guild settings, alerte admin, valute si request context.

### `src/infra/mongo/models.ts`

Modele: `GuildModel`, `CircuitBreakerModel`, `SystemModel`, `JobLockModel`, `AdminAlertCooldownModel`.

### `src/infra/mongo/locks.ts`

Functii: `attachLocks`, `acquireDbLock`, `renewDbLock`, `releaseDbLock`, `activeLocks`.

### `src/infra/mongo/migrations.ts`

Functii: `attachMigrations`, `runMigrations`, `ALL_MIGRATIONS`.

### `src/infra/mongo/systemState.ts`

Functii: `attachSystemState`, `getSystemTimes`, `saveSystemTimes`.

### `src/infra/mongo/guildSettings.ts`

Functii: `attachGuildSettings`, `getGuildSettings`, `invalidateGuildCache`, `cleanGuildCache`, `getGuildCacheSize`.

### `src/infra/mongo/adminAlerts.ts`

Functii: `attachAdminAlerts`, `adminAlert`.

## Infra HTTP

### `src/infra/http/client.ts`

Functii importante:

- `attachHttpClient(ctx)`;
- `attachMetrics(m)`;
- `cleanText(text)`;
- `truncate(str, maxLen)`;
- `normalizeTitleForDedupe(str)`: delega la `src/native/fuzzy.ts`;
- `stableUpdateId(title, link)`: delega la `src/native/fuzzy.ts`;
- `normalizeUpdate(data)`;
- `safeCheerioLoad(html)`;
- `normalizeDealState(deal)`: delega la `src/native/fuzzy.ts`;
- `dealHash(deal)`: delega la `src/native/fuzzy.ts`;
- `httpReq(method, url, options, retries, backoff)`;
- `fetchWithProxy(targetUrl, options)`;
- `withInflightTimeout(promise, label)`;
- `trackInflight(map, key, promise)`.

## Sources

### `src/sources/runtime.ts`

Expune dependinte pentru surse: `axios`, `cheerio`, `rss-parser`, `crypto` si infrastructura Mongo.

### `src/sources/sourceRegistry.ts`

Agregator pentru client HTTP, Steam helpers, update sources si deals sources. Expune si exporturi TypeScript pentru `dealHash`, `extractOfferEndFromHtml`, `safeCheerioLoad` si `MAX_HTML_BYTES`, folosite de testele existente.

### `src/sources/updates/index.ts`

Functii principale: `attachUpdates`, `fetchGameUpdate`, `executeFetchWithCircuitBreaker`, `getLatestForAllGames`.

### `src/sources/deals/index.ts`

Functii principale: `attachDeals`, `fetchSteamReviewData`, `enrichDealData`, `fetchDeals`, `cleanEnrichedCache`, `getEnrichedCacheSize`.

### `src/sources/steam/index.ts`

Functii principale: `attachSteam`, `searchSteamGameByName`, `chooseBestSteamMatch`, `fetchSteamPriceDetails`, `extractOfferEndFromHtml`, `extractSteamOfferEndDate`.

Atentie: `chooseBestSteamMatch` foloseste `levenshtein` din `src/native/fuzzy.ts`, deci scorarea textului vine din Rust cand addon-ul nativ este disponibil.

## Domain

### `src/domain/deals/filters.ts`

Functii: `dealPassesFilters`, `normalizePendingUpdateArray`, `normalizePendingDiscountArray`, `toEntries`, `mapToObject`, `getSeenSet`, `rotateAfter`.

## Commands

### `src/features/commands/commandRegistry.ts`

Agregator pentru cache, filtre, UI, notificari, slash commands si interactions. `fetchGameStatus` ajunge la `interactions.ts` prin destructure din ctx, ca toate celelalte handler-e (vechiul shim pe `globalThis` a fost scos in pasul 9).

### `src/features/commands/cache.ts`

Functii: cache runtime, cooldown-uri, `formatUserError`, `canSendEmbeds`, `makeActivationId` si helper-e LRU.

### `src/features/commands/ui.ts`

Functii: `enforceCooldown`, `startCommandLog`, `safeDefer`, `safeEdit`, `buildUpdateEmbed`, `buildDealEmbed`, `handlePagination`, `findGameAndSuggestion`, `fetchGameStatus`, `buildSteamPriceEmbed`.

Atentie: `findGameAndSuggestion` foloseste `levenshtein` primit prin contextul comun, care acum vine din `src/native/fuzzy.ts`.

### `src/features/commands/slashCommands.ts`

Functii: `attachSlashCommands`, `buildSlashCommandDefinitions`, `registerSlashCommands`.

### `src/features/commands/interactions.ts`

Proceseaza slash commands si autocomplete: `handleInteraction`, `handleAutocomplete`, `handleStartInteraction`, `handleStopInteraction`, `handleSetInteraction`, `handleLatestInteraction`, `handleDlcInteraction`, `handleStatusInteraction`, `buildHelpEmbed`.

## Notifications

### `src/features/notifications/index.ts`

Update-uri: `DISCORD_PERMANENT_ERROR_CODES`, `isPermanentDiscordError`, `transientErrorMessage`, `resolveOutboundChannel`, `claimSeenUpdate`, `rollbackSeenUpdate`, `disableUpdatesForChannelError`, `processGuildUpdates`, `buildOptimizedGameList`, `checkForUpdates`.

Reducerile: `claimSeenDiscount`, `rollbackSeenDiscount`, `disableDiscountsForChannelError`, `processGuildDiscounts`, `checkForDiscounts`.

Atentie: nu se elimina claim atomic, retry-ul Mongo, rollback-ul, pending queues, activation guards, codurile Discord permanente sau limita per ciclu. `resolveOutboundChannel` distinge codurile permanente (10003/10004/50001/50013) de erorile tranzitorii — pe tranzitoriu sare ciclul fara sa dezactiveze guild-ul.

## Scripts si teste

### `src/scripts/check-config.ts`

Valideaza `config.json`. Este dist-aware si gaseste config-ul real cand ruleaza din `dist/scripts`.

### `src/scripts/check-syntax.ts`

Verifica faptul ca nu exista fisiere JavaScript sursa ramase in `src`. Ignora `dist`, `target` si loader-ul N-API generat `native/index.js`; daca gaseste alt `.js` in sursa, CI pica si listeaza fisierul.

### `src/test/buildOptimizedGameList.test.ts`

Testeaza `buildOptimizedGameList` pentru guild-uri fara filtre, filtre per joc, uniuni intre guild-uri si chei stale.

### `src/test/commands-regression.test.ts`

Testeaza regresiile pentru comenzi, notificari, health, cron, Mongo, HTTP, sources, TypeScript build si protectiile portate din codul local.

### `src/test/configValidator.test.ts`

Testeaza forma acceptata a config-ului si validari pentru intervale, duplicate, Steam app IDs si `upCRD` legacy.

### `src/test/dealHash.test.ts`

Testeaza stabilitatea `dealHash`, inclusiv faptul ca modificarea textului datei de expirare nu creeaza o oferta noua. `dealHash` este acum expus prin clientul HTTP, dar calculul pur este delegat la wrapper-ul Rust.

### `src/test/extractOfferEndFromHtml.test.ts`

Testeaza parser-ul Steam pentru expresii de tip `Offer ends`, `Sale ends`, `Special promotion ends` si fallback-uri din HTML.

### `src/test/findGameAndSuggestion.test.ts`

Testeaza match-ul exact, aliasurile, fuzzy matching-ul si cache-ul pentru cautarea jocurilor.

### `src/test/rustFuzzy.test.ts`

Testeaza ca addon-ul Rust este incarcat in CI, ca `levenshtein` pastreaza distantele asteptate, ca helper-ul Rust de fuzzy matching returneaza cheile corecte si ca normalizarile/hash-urile Rust pastreaza contractele existente.

### `src/test/resolveOutboundChannel.test.ts`

Test comportamental pentru `resolveOutboundChannel` din `features/notifications/index.ts`. Verifica direct (cu stub-uri pentru `client.channels.fetch`, `canSendEmbeds` si `logger`):

- codul Discord permanent (10003/10004/50001/50013) cheama `disableFn` si aborteaza ciclul;
- eroarea tranzitorie (cod necunoscut, rate limit, network) NU cheama `disableFn`, doar logheaza si aborteaza ciclul;
- canalul nul (fetch reusit dar `null`) este tratat ca sters si cheama `disableFn`;
- canal valid fara permisiuni Send/Embed cheama `disableFn`;
- happy path returneaza canalul si `abort: false`.

Acopera si `isPermanentDiscordError` (toate cele 4 coduri + cazuri non-permanente) si `transientErrorMessage` (Error, obiecte cu `message`, null, undefined, string).

### `src/test/safeCheerioLoad.test.ts`

Testeaza incarcarea HTML sigura, taierea la limita de bytes si pastrarea codepoint-urilor UTF-8 valide.
