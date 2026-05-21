# V11 - stare curenta si schimbari utile

Acest document noteaza starea repo-ului dupa curatare, migrarea sursei la TypeScript, introducerea graduala a Rust, setup-ul de CI/Docker si ultimele imbunatatiri pentru testare, release, GHCR si securitate.

## Stare curenta

- Codul editabil al aplicatiei este in `src/`.
- JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala.
- Dependintele sunt blocate prin `src/package-lock.json`, iar CI foloseste `npm ci`.
- `src/tsconfig.json` ruleaza proiectul cu `strict: true` si `noImplicitAny: true`.
- `src/tsconfig.strict.json` include zone stabilizate explicit: health, scheduler, `filtersCore`, `outboundChannel`, HTTP client si teste directe.
- `src/legacy-dynamic.d.ts` ramane doar shim temporar pentru codul vechi care construieste contextul dinamic.
- Fisierele intentionate din afara `src` sunt documentatie si infrastructura: `README.md`, `CHANGELOG.md`, `SECURITY.md`, `LICENSE`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/` si `docs/assets/`.
- `.github/workflows/ci.yml` ruleaza verificarea principala.
- `.github/workflows/dependency-audit.yml` ruleaza audit npm saptamanal si manual.
- `.github/workflows/release.yml` ruleaza `npm run check`, publica imaginea Docker in GHCR si creeaza GitHub Release pentru tag-uri `v*.*.*`.
- `.github/dependabot.yml` deschide PR-uri saptamanale pentru dependinte npm din `src` si pentru GitHub Actions.
- `docker-compose.yml` nu publica MongoDB pe host; botul publica HTTP doar pe `127.0.0.1:3000`.
- `src/.env.example` documenteaza variabilele obligatorii si optionale importante pe categorii.
- `README.md` are badge-uri pentru CI, Dependency Audit, Release, Node.js si licenta MIT.
- `CHANGELOG.md` documenteaza versiunile, schimbarile notabile si imaginea GHCR.
- `SECURITY.md` documenteaza raportarea privata a vulnerabilitatilor.

## Rectificari recente din feedback

- A fost adaugat `src/test/startUpdatesFlow.e2e.test.ts`, un test end-to-end pentru fluxul `/start updates -> baseline Mongo -> cron -> embed -> seen`.
- A fost adaugat `src/test/startDiscountsFlow.e2e.test.ts`, un test end-to-end pentru fluxul `/start reduceri -> baseline reduceri -> cron -> deal embed -> seenDiscounts`.
- `.github/workflows/release.yml` publica imaginea Docker in GitHub Container Registry: `ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>` si `latest`.
- `src/.env.example` a fost rescris pe sectiuni clare: runtime, Mongo, Discord, metrics, proxy, webhook, logging, scraping, Discord throughput, circuit breaker, queue/cache si rate limit.
- `README.md`, `CHANGELOG.md` si documentele explicative au fost actualizate ca sa reflecte ultimele fisiere si fluxuri.

## Reducerea treptata a ctx legacy

Codul inca are module CommonJS care ataseaza functii pe un context comun. Directia corecta este sa fie mutate treptat in servicii/factory-uri tipate. Pasi deja facuti:

- `src/features/commands/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)` pentru installer-e injectate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure si tipate direct.
- `src/domain/deals/filters.ts` ramane doar adapter pentru contextul legacy.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat.
- `src/features/notifications/index.ts` foloseste `createOutboundChannelResolver`, dar pastreaza adapter-ul legacy pe `ctx`.
- `src/test/startUpdatesFlow.e2e.test.ts` si `src/test/startDiscountsFlow.e2e.test.ts` acopera acum fluxurile complete peste `interactions.ts` si `notifications/index.ts`, ca urmatoarea extragere din `ctx` sa fie protejata de teste functionale reale.

Urmatoarele zone bune de refactorizat sunt `features/commands/interactions.ts`, `features/notifications/index.ts` si `sources/`, dar in pasi separati si cu teste functionale langa fiecare extragere.

## Bug fix-uri si imbunatatiri portate

- `METRICS_TOKEN` placeholder este tratat ca lipsa, ca sa nu para production-safe din greseala.
- `safeCheerioLoad` taie HTML-ul mare pe limita de bytes fara sa rupa caractere UTF-8.
- `dealHash` nu mai include textul volatil al datei de expirare.
- `extractOfferEndFromHtml(html)` parseaza mai robust textele Steam pentru finalul ofertelor.
- `getLatestForAllGames` foloseste cache key bazat pe lista efectiva de jocuri.
- `buildOptimizedGameList(allGames, subscribedGuilds)` evita scraping-ul jocurilor nefolosite.
- `findGameAndSuggestion` foloseste cache LRU pentru autocomplete si fuzzy matching.
- `features/commands/ui.ts::refreshGuard` goleste `findGameCache` cand array-ul `games` se schimba.
- HTTP foloseste agenti keep-alive, retry/backoff, proxy fallback, abort signal si `errorMessage` pentru erori non-Error.
- `src/infra/http/client.ts::assertSafeExternalUrl` valideaza destinatiile externe: doar `http`/`https`, fara credentiale in URL, localhost, IPv4 private sau IPv6 locale/private.
- `fetchWithProxy` valideaza URL-ul tinta si template-urile din `PROXY_URLS`.
- Epic GraphQL deals retry-uieste 429 chiar si pe POST, pentru ca acel POST este semantic o citire.
- Claim-urile atomice Mongo pentru update-uri si reduceri folosesc `withMongoRetry`.
- Cron-ul are lock distribuit, heartbeat, health window si backoff global.
- `app/scheduler/cron.ts::stop()` curata `cronTimerId` dupa `clearTimeout`.
- `src/app/health/httpServer.ts` construieste metricile prin `pushMetric`, ca aceeasi metrica Prometheus sa nu fie emisa accidental de doua ori.
- Erorile Discord permanente `10003`, `10004`, `50001`, `50013` dezactiveaza canalul afectat.
- A fost adaugat sistem de migrari DB la pornire.
- A fost adaugata schema JSON pentru `config.json`.
- `runCronCycle` prinde erorile din `acquireDbLock`, le trimite in `cronErrors`, health window si alerta `cron:lock`, apoi programeaza urmatorul ciclu.
- `handleStatusInteraction` foloseste `fetchGameStatus` din context, nu shim temporar pe `globalThis`.
- `features/notifications/index.ts` normalizeaza mesajele de eroare tranzitorii prin helper-ul comun.
- `sources/deals/index.ts::enrichedCache` foloseste cheia `${dealId}:${currency}` pentru deployment multi-currency.
- `app/lifecycle/shutdown.ts` asteapta `client.destroy()` in cleanup-ul controlat.
- `sources/updates/index.ts::fetchListingBasedUpdate` fetch-uieste URL-urile de listing paralel si pastreaza tiebreaker determinist.
- `app/scheduler/housekeeping.ts::start()` este idempotent.
- `sources/updates/index.ts::fetchNvidiaUpdate` respinge fallback-ul RSS fara titlu sau cu titlu gol dupa curatare.
- `npm start` porneste doar codul compilat din `dist/app/main.js`; `npm run dev` face build + start pentru dezvoltare.

## TypeScript si Rust

Sursa din `src` este TypeScript. `src/tsconfig.json` are `allowJs: false`, `strict: true` si `noImplicitAny: true`, iar `src/scripts/check-syntax.ts` pica verificarea daca apar fisiere `.js` manuale in sursa, cu exceptiile generate cunoscute.

Rust este limitat la algoritmi puri si repetitivi, unde ajuta fara sa mute Discord, Mongo sau HTTP peste granita N-API:

- `src/native/src/lib.rs` implementeaza `levenshtein` si helper bulk pentru fuzzy matching.
- `src/native/fuzzy.ts` este puntea TypeScript catre addon-ul nativ si are fallback TypeScript pentru dezvoltare locala fara binar.
- Normalizarea titlurilor, ID-urile stabile de update si hash-urile de deal sunt delegate catre Rust.
- `cleanText`, `classifyPatchNote`, `scoreListingCandidate`, `isGoodSteamArticleUrl` si `extractDateScore` au nucleu Rust cu fallback compatibil in TypeScript.
- `src/test/rustFuzzy.test.ts` verifica explicit ca addon-ul Rust este incarcat in CI si acopera helperii nativi.

Nu au fost mutate in Rust zonele de Discord, Mongo, HTTP, retry/backoff, proxy fallback sau parsare HTML cu Cheerio, fiindca acolo timpul real este dominat de retea/IO si riscul ar fi mai mare decat castigul.

## Build, CI si release

- `src/package-lock.json` este prezent in repo si blocheaza versiunile efective de dependinte.
- `src/package.json` are scripturi separate pentru build Rust, build TypeScript, start, dev, typecheck, strict, test, audit si check.
- `.github/workflows/ci.yml` ruleaza `npm run check` in `src` cu Node.js 20 si Rust stable.
- `.github/workflows/dependency-audit.yml` ruleaza audit runtime saptamanal.
- `.github/workflows/release.yml` ruleaza `npm run check`, construieste Dockerfile-ul, publica imaginea in GHCR si creeaza GitHub Release.
- `.github/dependabot.yml` propune update-uri controlate pentru npm si GitHub Actions.
- `Dockerfile` face build multi-stage, iar `docker-compose.yml` porneste botul impreuna cu MongoDB fara sa publice Mongo pe host.
- `src/.gitignore` ignora output-ul generat: `dist/`, `node_modules/`, `native/target/`, fisierele native `.node`, `native/index.js` si `native/index.d.ts`.

## Acoperire de teste

- `src/test/startUpdatesFlow.e2e.test.ts` verifica fluxul complet `/start updates`, baseline-ul Mongo, cron-ul, trimiterea embed-ului si marcarea `seen`.
- `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxul complet `/start reduceri`, baseline-ul reducerilor, cron-ul, trimiterea embed-ului si marcarea `seenDiscounts`.
- `src/test/resolveOutboundChannel.test.ts` verifica direct serviciul de rezolvare canal Discord si erorile permanente vs tranzitorii.
- `src/test/setGamesInteraction.functional.test.ts` verifica functional `/set games add/remove` si cheia invalida.
- `src/test/httpClientSecurity.test.ts` verifica respingerea URL-urilor externe nesigure si proxy fallback.
- `src/test/mongoMigrations.functional.test.ts` verifica migrarile Mongo cu colectii fake, trim-ul `seenDiscounts`, update-ul starii si release-ul lock-ului.
- `src/test/commandRegistry.functional.test.ts` verifica registrul de comenzi cu installer-e injectate.
- `src/test/dealFiltersCore.functional.test.ts` verifica filtrele de reduceri exportate direct din core-ul tipat.
- `src/test/cronController.test.ts` verifica faptul ca `stop()` curata handle-ul programat si ramane idempotent.
- `src/test/commands-regression.test.ts` ramane guard textual pentru lock, abort signal, health, notificari, cache, surse, registrul de comenzi si guard-urile RSS.
- `src/test/housekeeping.test.ts` verifica idempotenta housekeeping.
- Testele de domeniu acopera `buildOptimizedGameList`, `dealHash`, `extractOfferEndFromHtml`, `findGameAndSuggestion`, `safeCheerioLoad` si helperii Rust.

## Ce nu am copiat 1:1

Fisierele locale mari au fost tratate ca sursa de idei, nu copiate ca fisiere noi. Repo-ul ramane impartit pe functionalitati:

- `commands.js` -> `src/features/commands/*` si `src/features/notifications/index.ts`.
- `scrapers.js` -> `src/infra/http/client.ts`, `src/native/*` si `src/sources/*`.
- `db.js` -> `src/shared/*` si `src/infra/mongo/*`.
- `index.js` -> `src/app/*`.

Nu au fost readuse fisiere duplicate de cod in afara lui `src`. Fisierele noi din radacina sunt documentatie, exemple vizuale sau infrastructura de rulare/verificare.
