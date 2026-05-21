# V11 - schimbari utile portate

Acest document noteaza starea curenta a repo-ului dupa curatare, migrarea la TypeScript, introducerea graduala a Rust si redenumirea fisierelor dupa functionalitate.

## Stare curenta

- Codul editabil este in `src/`.
- JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala.
- Dependintele sunt blocate prin `src/package-lock.json`, iar CI foloseste instalare reproductibila cu `npm ci`.
- Exceptia intentionata din afara `src` este `.github/workflows/ci.yml`, fiindca GitHub Actions citeste workflow-urile doar din `.github/workflows`.
- Agregatoarele cu nume generic au fost redenumite dupa rol:
  - `src/infra/mongo/mongoContext.ts` pentru contextul Mongo.
  - `src/sources/sourceRegistry.ts` pentru registrul de surse externe.
  - `src/features/commands/commandRegistry.ts` pentru registrul de comenzi Discord.
- Fisierele descriptive actualizate pentru starea curenta sunt `src/docs/CONTEXT_REPO_CLEAN.md`, `src/docs/FUNCTION_MAP_CLEAN.md`, `src/docs/FILE_RENAME_MAP.md` si acest changelog.

## Bug fix-uri si imbunatatiri portate

- `METRICS_TOKEN` placeholder este tratat ca lipsa, ca sa nu para production-safe din greseala.
- `safeCheerioLoad` taie HTML-ul mare pe limita de bytes fara sa rupa caractere UTF-8.
- `dealHash` nu mai include textul volatil al datei de expirare.
- `extractOfferEndFromHtml(html)` parseaza mai robust textele Steam pentru finalul ofertelor si evita fallback-ul prea larg pe tot documentul.
- `getLatestForAllGames` foloseste cache key bazat pe lista efectiva de jocuri.
- `buildOptimizedGameList(allGames, subscribedGuilds)` evita scraping-ul jocurilor nefolosite.
- `findGameAndSuggestion` foloseste cache LRU pentru autocomplete si fuzzy matching.
- `features/commands/ui.ts::refreshGuard` goleste `findGameCache` cand array-ul `games` se schimba, ca vechile intrari nereferentiabile sa nu stea pana la pragul LRU.
- HTTP foloseste agenti keep-alive, retry/backoff, proxy fallback, abort signal si `errorMessage` pentru erori non-Error.
- `src/infra/http/client.ts::assertSafeExternalUrl` valideaza destinatiile externe inainte de request: accepta doar `http`/`https`, respinge credentialele in URL, host-urile locale/private IPv4, IPv6 loopback/link-local/unique-local si template-urile proxy fara `{url}`.
- `fetchWithProxy` valideaza URL-ul tinta inainte sa-l puna in proxy si valideaza template-urile din `PROXY_URLS` la pornirea clientului HTTP.
- Epic GraphQL deals retry-uieste 429 chiar si pe POST, pentru ca acel POST este semantic o citire.
- Claim-urile atomice Mongo pentru update-uri si reduceri folosesc `withMongoRetry`.
- Cron-ul are lock distribuit, heartbeat, health window si backoff global.
- `app/scheduler/cron.ts::stop()` curata `cronTimerId` dupa `clearTimeout`, ca oprirea controllerului sa nu lase un handle stale in stare.
- `src/app/health/httpServer.ts` construieste metricile printr-un helper central (`pushMetric`), ca aceeasi metrica Prometheus sa nu poata fi emisa accidental de doua ori.
- `src/features/commands/commandRegistry.ts` declara functiile de context cerute si arunca explicit daca o dependinta lipseste. Pattern-ul legacy cu `ctx` injectat ramane de redus gradual catre factory-uri mai explicite.
- Erorile Discord permanente `10003`, `10004`, `50001`, `50013` dezactiveaza canalul afectat.
- A fost adaugat sistem de migrari DB la pornire.
- A fost adaugata schema JSON pentru `config.json`.
- `runCronCycle` prinde erorile din `acquireDbLock`, le trimite in `cronErrors`, health window si alerta `cron:lock`, apoi programeaza urmatorul ciclu.
- `handleStatusInteraction` foloseste `fetchGameStatus` din context, nu shim temporar pe `globalThis`.
- `features/notifications/index.ts` normalizeaza mesajele de eroare tranzitorii prin helper-ul comun.
- `sources/deals/index.ts::enrichedCache` foloseste cheia `${dealId}:${currency}`, deci cache-ul functioneaza corect in deployment multi-currency.
- `app/lifecycle/shutdown.ts` asteapta `client.destroy()` ca teardown-ul Discord sa intre in cleanup-ul controlat.
- `sources/updates/index.ts::fetchListingBasedUpdate` fetch-uieste URL-urile de listing paralel si pastreaza tiebreaker-ul determinist.
- `app/scheduler/housekeeping.ts::start()` este idempotent: daca housekeeping ruleaza deja, un al doilea apel nu mai porneste inca un `setInterval` fara handle de oprire.
- `sources/updates/index.ts::fetchNvidiaUpdate` respinge fallback-ul RSS fara titlu sau cu titlu gol dupa curatare, ca sursa stricata sa intre in circuit breaker in loc sa produca update-uri goale.

## TypeScript complet pe sursa

Sursa din `src` a fost mutata la TypeScript. `src/tsconfig.json` are `allowJs: false`, iar `src/scripts/check-syntax.ts` pica verificarea daca apar fisiere `.js` manuale in sursa, cu exceptiile generate cunoscute.

`src/tsconfig.strict.json` introduce treptat `strict: true` si `noImplicitAny: true` pe fisierele mai stabile sau nou intarite: health HTTP, cron, housekeeping, registrul de comenzi, clientul HTTP, erori shared si testele directe aferente. `npm run typecheck:strict`, `npm run lint` si `npm run check` ruleaza aceasta verificare, fara sa forteze inca tot proiectul legacy dintr-o singura mutare riscanta.

Zone convertite si mentinute in TypeScript:

- `src/app/main.ts`, lifecycle, health, scheduler si shutdown.
- `src/config/configValidator.ts` si `src/config/configLoader.ts`.
- `src/shared/errors.ts`, `logging.ts`, `env.ts`, `domain.ts`, `utilities.ts`.
- `src/infra/http/client.ts`.
- `src/infra/mongo/mongoContext.ts`, `runtime.ts`, `models.ts`, `guildSettings.ts`, `adminAlerts.ts`, `locks.ts`, `systemState.ts`, `migrations.ts`.
- `src/sources/sourceRegistry.ts`, `runtime.ts`, `steam/index.ts`, `deals/index.ts`, `updates/index.ts`.
- `src/features/commands/commandRegistry.ts`, `cache.ts`, `ui.ts`, `slashCommands.ts`, `interactions.ts`.
- `src/features/notifications/index.ts`.
- Scripturile si testele din `src/scripts` si `src/test`.

## Rust gradual

Rust este limitat la algoritmi puri si repetitivi, unde ajuta fara sa mute Discord, Mongo sau HTTP peste granita N-API.

- `src/native/src/lib.rs` implementeaza `levenshtein` si helper bulk pentru fuzzy matching.
- `src/native/fuzzy.ts` este puntea TypeScript catre addon-ul nativ si are fallback TypeScript pentru dezvoltare locala fara binar.
- Normalizarea titlurilor, ID-urile stabile de update si hash-urile de deal sunt delegate catre Rust.
- `cleanText`, `classifyPatchNote`, `scoreListingCandidate`, `isGoodSteamArticleUrl` si `extractDateScore` au nucleu Rust cu fallback compatibil in TypeScript.
- `src/test/rustFuzzy.test.ts` verifica explicit ca addon-ul Rust este incarcat in CI si acopera helperii nativi.

Nu au fost mutate in Rust zonele de Discord, Mongo, HTTP, retry/backoff, proxy fallback sau parsare HTML cu Cheerio, fiindca acolo timpul real este dominat de retea/IO si riscul ar fi mai mare decat castigul.

## Schimbari de build si CI

- `src/package-lock.json` este prezent in repo si blocheaza versiunile efective de dependinte.
- `src/package.json` are `build:rust`, `build:ts`, `build`, `typecheck`, `typecheck:strict`, `lint` si `check`.
- `npm run check` ruleaza `typecheck`, `typecheck:strict`, compileaza addon-ul Rust, compileaza TypeScript-ul si ruleaza testele.
- `.github/workflows/ci.yml` foloseste Node.js 20, instaleaza Rust stable, lucreaza cu `working-directory: src`, instaleaza dependintele cu `npm ci` si ruleaza `npm run check`.
- `src/.gitignore` ignora output-ul generat: `dist/`, `node_modules/`, `native/target/`, fisierele native `.node`, `native/index.js` si `native/index.d.ts`.
- `src/legacy-dynamic.d.ts` ramane doar ca punte temporara pentru obiecte legacy construite dinamic.

## Acoperire de teste

- `src/test/resolveOutboundChannel.test.ts` verifica comportamentul permanent vs tranzitoriu pentru erori Discord.
- `src/test/cronController.test.ts` verifica comportamental ca `stop()` curata handle-ul programat si ramane idempotent.
- `src/test/httpClientSecurity.test.ts` verifica respingerea URL-urilor externe nesigure, inclusiv `file:`, localhost, IPv4/IPv6 local sau privat, credentiale in URL si template-uri proxy fara `{url}`.
- `src/test/commands-regression.test.ts` acopera protectiile textuale pentru lock, abort signal, health, notificari, cache, surse, registrul de comenzi si guard-urile RSS pentru drivere.
- `src/test/housekeeping.test.ts` verifica direct ca `createHousekeeping().start()` porneste un singur interval chiar daca este apelat de doua ori si ca `stop()` curata intervalul.
- Testele de domeniu acopera `buildOptimizedGameList`, `dealHash`, `extractOfferEndFromHtml`, `findGameAndSuggestion`, `safeCheerioLoad` si helperii Rust.

## Ce nu am copiat 1:1

Fisierele locale mari au fost tratate ca sursa de idei, nu copiate ca fisiere noi. Repo-ul ramane impartit pe functionalitati:

- `commands.js` -> `src/features/commands/*` si `src/features/notifications/index.ts`.
- `scrapers.js` -> `src/infra/http/client.ts`, `src/native/*` si `src/sources/*`.
- `db.js` -> `src/shared/*` si `src/infra/mongo/*`.
- `index.js` -> `src/app/*`.

Nu am readus fisiere duplicate in afara lui `src`.
