# Context repo curat

## Scopul proiectului

Repo-ul contine un bot Discord pentru notificari automate despre patch notes, update-uri de jocuri, reduceri Steam/Epic, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Codul sursa editabil al aplicatiei este in `src`. JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala. Nucleul Rust este in `src/native` si este folosit doar pentru algoritmi puri de fuzzy matching, normalizare, hashing si helperi de text/URL.

## Structura principala

Aplicatia sta sub `src`, iar radacina repo-ului contine documentatie, release notes, politica de securitate, exemple vizuale, CI, licenta si infrastructura de rulare.

```text
README.md
CHANGELOG.md
SECURITY.md
LICENSE
Dockerfile
docker-compose.yml
.dockerignore
.github/
  dependabot.yml
  workflows/
    ci.yml
    dependency-audit.yml
    release.yml
docs/
  assets/
    embed-help.svg
    embed-update.svg
    embed-discount.svg
src/
  .env.example
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.strict.json
  app/
    main.ts
    health/
    lifecycle/
    scheduler/
  config/
  domain/
    deals/
      filters.ts
      filtersCore.ts
  features/
    commands/
      commandRegistry.ts
      interactions.ts
      ui.ts
    notifications/
      index.ts
      outboundChannel.ts
  infra/
    http/
    mongo/
  native/
    fuzzy.ts
    src/lib.rs
  scripts/
  shared/
  sources/
  test/
    commandRegistry.functional.test.ts
    commands-regression.test.ts
    cronController.test.ts
    dealFiltersCore.functional.test.ts
    housekeeping.test.ts
    httpClientSecurity.test.ts
    mongoMigrations.functional.test.ts
    resolveOutboundChannel.test.ts
    rustFuzzy.test.ts
    setGamesInteraction.functional.test.ts
    sourceRegistry.functional.test.ts
    startDiscountsFlow.e2e.test.ts
    startUpdatesFlow.e2e.test.ts
    ...
  docs/
```

`dist/`, `node_modules/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output-uri generate si nu se editeaza manual.

## Rulare si verificare

Instalarea dependintelor se face din `src` cu lockfile-ul comis:

```bash
cd src
npm ci
cp .env.example .env
```

`src/.env.example` documenteaza variabilele pe categorii: runtime, Mongo, Discord, metrics, reverse proxy, admin webhook, proxy URL templates, logging, scraping, Discord throughput, circuit breaker, pending queues, cache-uri, Mongo pool si HTTP rate limit.

Pentru dezvoltare locala, dupa ce completezi `src/.env`, foloseste:

```bash
npm run dev
```

Pentru productie sau Docker, build-ul si pornirea sunt separate:

```bash
npm run build
npm start
```

`npm start` porneste doar codul deja compilat din `dist/app/main.js`.

Verificari importante:

```bash
npm run check
npm run audit
```

`npm run check` ruleaza `typecheck`, `typecheck:strict`, build Rust + TypeScript, syntax check, config check si testele din `dist/test`. `npm run audit` verifica dependintele runtime.

Din radacina repo-ului poti porni botul si MongoDB cu:

```bash
docker compose up --build
```

Compose tine MongoDB doar in reteaua Docker interna (`expose: 27017`) si publica botul doar pe `127.0.0.1:3000`. Pentru acces local temporar la Mongo din host trebuie folosit un override necomis si legat doar pe loopback.

## README, changelog, security si licenta

README-ul are badge-uri pentru CI, Dependency Audit, Release, Node.js >=20 si licenta MIT. Licenta proiectului este in `LICENSE`.

`CHANGELOG.md` tine istoricul de versiuni si explica tag-urile semver `vMAJOR.MINOR.PATCH`. Pentru un release nou se actualizeaza changelog-ul, se face merge in `main`, apoi se impinge un tag de forma `v1.1.0`.

`SECURITY.md` explica raportarea privata a vulnerabilitatilor prin GitHub Security Advisories si cere ca tokenurile, credentialele Mongo, `METRICS_TOKEN`, webhook-urile si proxy URL-urile sa nu fie publicate in issue-uri, PR-uri sau loguri.

## Docker si GHCR

`Dockerfile` face build multi-stage: compileaza Rust/N-API si TypeScript in stage-ul de build, apoi imaginea runtime instaleaza doar dependintele production si porneste `npm start`.

`.github/workflows/release.yml` publica imaginea Docker in GitHub Container Registry la fiecare tag `v*.*.*` sau release manual:

```text
ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>
ghcr.io/ciobotaruandrei/discord-patch-bot:latest
```

Workflow-ul ruleaza `npm run check` inainte sa publice imaginea si inainte sa creeze GitHub Release.

## Flow de pornire

`src/app/main.ts` este orchestratorul. Dupa build, se ruleaza ca `dist/app/main.js`.

Flow-ul curent:

1. `src/infra/mongo/mongoContext.ts` construieste contextul comun.
2. Se ataseaza logging, env, domain, utilities, modele Mongo, lock-uri, migrari, state global, guild cache si alerte admin.
3. `loadConfig` incarca si valideaza config-ul.
4. Se creeaza metricile si se leaga de surse.
5. Se creeaza clientul Discord.
6. Se creeaza rate limiter-ul, housekeeping-ul, cron controller-ul si HTTP server-ul.
7. Se inregistreaza lifecycle handlers pentru Discord, Mongo si shutdown.
8. Se conecteaza MongoDB.
9. Se ruleaza migrarile DB.
10. Se porneste serverul HTTP.
11. Se face login la Discord.

Logica mare nu trebuie pusa direct in `main.ts`; ea sta in modulele din `app`, `features`, `infra`, `shared`, `sources` si, pentru cod nativ pur, `native`.

## TypeScript si ctx legacy

Regula curenta: sursa aplicatiei din `src` este TypeScript. Runtime-ul compilat TypeScript este CommonJS, deci importurile prin `require` si `module.exports` sunt acceptate unde ajuta la migrare sigura.

`src/tsconfig.json` compileaza doar `.ts` si `.d.ts`, are `allowJs: false`, `strict: true`, `noImplicitAny: true`, foloseste `module: CommonJS`, `moduleDetection: force` si exclude `dist`, `node_modules` si `coverage`.

`src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy construite dinamic. Codul nou nu trebuie sa copieze acest model.

Reducerea treptata a `ctx` dinamic:

- `src/features/commands/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)`, deci installer-ele pot fi injectate si testate explicit.
- `src/sources/sourceRegistry.ts` expune `createSourceRegistry(baseContext, installers)`, deci sursele HTTP, Steam, updates si deals pot fi injectate si testate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure tipate direct.
- `src/domain/deals/filters.ts` ramane adapter pentru codul legacy care asteapta atasare pe context.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat, iar `src/features/notifications/index.ts` il foloseste prin dependinte injectate.
- `src/test/startUpdatesFlow.e2e.test.ts` si `src/test/startDiscountsFlow.e2e.test.ts` acopera fluxurile complete `/start updates` si `/start reduceri` plus cron, ca extragerile viitoare din `interactions.ts` si `notifications/index.ts` sa aiba guard functional.

Urmatoarele tinte sanatoase pentru refactor sunt `features/commands/interactions.ts` si `features/notifications/index.ts`, mutate treptat spre factory-uri cu dependinte explicite.

## Rust

Rust este introdus gradual si doar unde are sens practic.

- `src/native/src/lib.rs` implementeaza fuzzy matching, normalizari, hash-uri stabile si helperi de text/URL din hot path-ul de scraping.
- `src/native/fuzzy.ts` incarca addon-ul `.node`, expune wrapper-ele TypeScript si pastreaza fallback-uri compatibile.
- `src/infra/http/client.ts` si `src/sources/updates/index.ts` deleaga helperii puri catre `src/native/fuzzy.ts`.

Nu s-au mutat in Rust Discord handlers, Mongo queries, HTTP client/retries/proxy fallback sau parsarea HTML cu Cheerio, fiindca sunt dominate de IO si integrare cu librarii JS.

## MongoDB

Module importante:

- `src/infra/mongo/runtime.ts`: dependinte comune pentru context.
- `src/infra/mongo/mongoContext.ts`: agregatorul infrastructurii Mongo.
- `src/infra/mongo/models.ts`: modelele `Guild`, `CircuitBreaker`, `System`, `JobLock`, `AdminAlertCooldown`.
- `src/infra/mongo/locks.ts`: lock-uri distribuite.
- `src/infra/mongo/migrations.ts`: migrari DB idempotente.
- `src/infra/mongo/systemState.ts`: timpi globali.
- `src/infra/mongo/guildSettings.ts`: cache guild settings.
- `src/infra/mongo/adminAlerts.ts`: alerte admin cu cooldown atomic.

## HTTP si sources

Clientul HTTP comun este in `src/infra/http/client.ts`. El gestioneaza retry/backoff, limite de bytes, user-agent random, proxy fallback, hashing, normalizare, in-flight coalescing si abort signal.

`src/sources/sourceRegistry.ts` leaga clientul HTTP, helperii Steam, update sources si deals sources prin `createSourceRegistry(baseContext, installers)`. Exporturile vechi raman compatibile, dar wiring-ul poate fi testat fara sa depinda de contextul runtime implicit.

Tot in clientul HTTP se valideaza URL-urile externe inainte de request. `assertSafeExternalUrl` accepta doar `http` si `https`, respinge credentialele din URL, host-urile locale/private IPv4, IPv6 loopback/link-local/unique-local si orice template proxy fara `{url}`. `fetchWithProxy` valideaza intai URL-ul tinta si apoi encodeaza varianta canonica in proxy.

Sursele externe sunt fragile prin natura lor, pentru ca depind de HTML, RSS si API-uri care se pot schimba. Repo-ul pastreaza defensiv `SchemaDriftError`, circuit breaker, fallback-uri si teste pentru cazurile unde sursa incepe sa dea date goale sau forme neasteptate.

## Commands si notificari

Comenzile sunt in `src/features/commands`:

- `commandRegistry.ts`: agregatorul comenzilor si contractul functiilor cerute din context.
- `cache.ts`: cache runtime, cooldown-uri si LRU.
- `ui.ts`: embed-uri, paginare, fuzzy matching, status si pret Steam.
- `slashCommands.ts`: definitii si inregistrare slash commands.
- `interactions.ts`: handler-ele slash si autocomplete.

Notificarile automate sunt in `src/features/notifications`:

- `index.ts`: fluxurile cron pentru update-uri si reduceri, claim atomic, rollback si pending queues.
- `outboundChannel.ts`: resolver tipat pentru fetch canal Discord, permisiuni embed si erori permanente/tranzitorii.

Reguli care nu trebuie rupte: claim atomic pentru `seen`, rollback cand Discord send esueaza, pending queues, activation id pentru `/start`, filtre per joc/store/pret/procent, ping de rol o singura data per ciclu si dezactivare canal pentru erori Discord permanente.

## Domain deals

`src/domain/deals/filtersCore.ts` contine partea tipata si importabila direct:

- `dealPassesFilters`
- `normalizePendingUpdateArray`
- `normalizePendingDiscountArray`
- `toEntries`
- `mapToObject`
- `getSeenSet`
- `rotateAfter`

`src/domain/deals/filters.ts` este adapter-ul legacy care ataseaza aceleasi functii pe `ctx`. Codul nou trebuie sa importe din `filtersCore.ts` cand are nevoie de filtre.

## Scheduler si housekeeping

`src/app/scheduler/cron.ts` coordoneaza ciclurile de update si foloseste lock distribuit, health window, backoff global si curatarea handle-ului programat la `stop()`.

`src/app/scheduler/housekeeping.ts` curata cache-uri si rate limiter-ul. `start()` este idempotent: daca exista deja timer, un al doilea apel returneaza fara sa porneasca inca un interval.

## Health si metrics

`src/app/health/httpServer.ts` expune `/health`, `/healthz` si `/metrics`. Metricile Prometheus sunt construite prin `pushMetric`, care tine un set cu numele deja emise si evita duplicarea accidentala a liniilor pentru aceeasi metrica.

In productie `/metrics` trebuie protejat cu un `METRICS_TOKEN` real, exceptand cazul in care `METRICS_PUBLIC=true` este setat intentionat.

## GitHub Actions si mentenanta

- `.github/workflows/ci.yml` ruleaza pe push, pull request si pornire manuala, foloseste Node.js 20, instaleaza Rust stable, instaleaza dependintele in `src` cu `npm ci` si executa `npm run check`.
- `.github/workflows/dependency-audit.yml` ruleaza saptamanal si manual `npm audit --omit=dev --audit-level=moderate` in `src`.
- `.github/workflows/release.yml` ruleaza la tag-uri `v*.*.*` sau manual cu input `tag`; face checkout pe ref-ul de release, ruleaza `npm run check`, publica imaginea Docker in GHCR si creeaza GitHub Release.
- `.github/dependabot.yml` propune PR-uri saptamanale pentru npm si GitHub Actions, cu grupuri separate pentru dependinte runtime, build/types si actions.

## Teste si scripturi

Scripturile sunt TypeScript:

- `src/scripts/check-config.ts` valideaza config-ul.
- `src/scripts/check-syntax.ts` pica verificarea daca apare orice fisier `.js` in sursa `src`, ignorand output-ul generat din `dist` si loader-ul N-API `native/index.js`.

Teste importante:

- `src/test/startUpdatesFlow.e2e.test.ts` verifica fluxul complet `/start updates -> baseline Mongo -> cron -> embed -> seen`.
- `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxul complet `/start reduceri -> baseline reduceri -> cron -> deal embed -> seenDiscounts`.
- `src/test/commandRegistry.functional.test.ts` verifica registrul de comenzi cu installer-e mock injectate.
- `src/test/sourceRegistry.functional.test.ts` verifica registrul de surse cu installer-e mock injectate.
- `src/test/dealFiltersCore.functional.test.ts` verifica direct filtrele de reduceri si helperii de normalizare.
- `src/test/setGamesInteraction.functional.test.ts` verifica functional `/set games add/remove` si cheia invalida.
- `src/test/mongoMigrations.functional.test.ts` verifica migrarile Mongo cu colectii fake si release de lock.
- `src/test/resolveOutboundChannel.test.ts` verifica direct serviciul de canal Discord pentru erori permanente vs tranzitorii.
- `src/test/httpClientSecurity.test.ts` verifica URL guard-ul si proxy fallback-ul.
- `src/test/commands-regression.test.ts` ramane guard textual pentru regresii importante.
- `src/test/cronController.test.ts`, `src/test/housekeeping.test.ts` si `src/test/rustFuzzy.test.ts` acopera scheduler, housekeeping si helperii nativi.
