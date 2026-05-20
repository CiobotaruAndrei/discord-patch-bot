# Context repo curat

## Scopul proiectului

Repo-ul contine un bot Discord pentru notificari automate despre patch notes, update-uri de jocuri, reduceri Steam/Epic, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Codul sursa editabil este in `src`. JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala. Nucleul Rust este in `src/native` si este folosit doar pentru algoritmi puri de fuzzy matching, normalizare, hashing si helperi de text/URL.

## Structura principala

Aproape tot ce tine de proiect sta sub `src`. Singura exceptie intentionata este workflow-ul real de GitHub Actions din `.github/workflows/ci.yml`.

```text
.github/
  workflows/
    ci.yml
src/
  app/
    main.ts
    health/
    lifecycle/
    scheduler/
      cron.ts
      housekeeping.ts
  config/
  domain/
  features/
    commands/
      cache.ts
      commandRegistry.ts
      interactions.ts
      slashCommands.ts
      ui.ts
    notifications/
      index.ts
  infra/
    http/
      client.ts
    mongo/
      adminAlerts.ts
      guildSettings.ts
      locks.ts
      migrations.ts
      models.ts
      mongoContext.ts
      runtime.ts
      systemState.ts
  native/
    fuzzy.ts
    src/lib.rs
  scripts/
  shared/
  sources/
    sourceRegistry.ts
    runtime.ts
    deals/index.ts
    steam/index.ts
    updates/index.ts
  test/
    commands-regression.test.ts
    housekeeping.test.ts
    rustFuzzy.test.ts
    ...
  docs/
```

`dist/`, `node_modules/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output-uri generate si nu se editeaza manual.

## Rulare si verificare

Rularea normala se face din `src`:

```bash
npm start
```

Verificarea completa se face cu:

```bash
npm run check
```

`npm run check` ruleaza typecheck, build Rust + TypeScript, syntax check, config check si testele din `dist/test`.

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

## TypeScript

Regula curenta: sursa aplicatiei din `src` este TypeScript. Runtime-ul ramane CommonJS dupa compilare, deci importurile prin `require` si `module.exports` sunt acceptate unde ajuta la migrare sigura.

`src/tsconfig.json` compileaza doar `.ts` si `.d.ts`, are `allowJs: false`, foloseste `module: CommonJS`, `moduleDetection: force` si exclude `dist`, `node_modules` si `coverage`.

`src/legacy-dynamic.d.ts` este un shim temporar pentru cateva obiecte legacy construite dinamic. Codul nou nu trebuie sa copieze acest model.

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

Sursele externe sunt in `src/sources`:

- `runtime.ts`: dependinte comune pentru surse.
- `sourceRegistry.ts`: agregatorul surselor si exporturile tipate folosite de teste.
- `steam/index.ts`: cautare Steam, preturi, parser de expirare oferte si alegere best match.
- `deals/index.ts`: reduceri Steam/Epic, enrich cache si review scoring.
- `updates/index.ts`: patch notes, listing-based scraping, circuit breaker, schema drift si guard-uri pentru fallback-uri RSS de drivere fara titlu valid.

## Commands si notificari

Comenzile sunt in `src/features/commands`:

- `commandRegistry.ts`: agregatorul comenzilor.
- `cache.ts`: cache runtime, cooldown-uri si LRU.
- `ui.ts`: embed-uri, paginare, fuzzy matching, status si pret Steam.
- `slashCommands.ts`: definitii si inregistrare slash commands.
- `interactions.ts`: handler-ele slash si autocomplete.

Notificarile automate sunt in `src/features/notifications/index.ts`.

Reguli care nu trebuie rupte: claim atomic pentru `seen`, rollback cand Discord send esueaza, pending queues, activation id pentru `/start`, filtre per joc/store/pret/procent, ping de rol o singura data per ciclu si dezactivare canal pentru erori Discord permanente.

## Scheduler si housekeeping

`src/app/scheduler/cron.ts` coordoneaza ciclurile de update si foloseste lock distribuit, health window si backoff global.

`src/app/scheduler/housekeeping.ts` curata cache-uri si rate limiter-ul. `start()` este idempotent: daca exista deja timer, un al doilea apel returneaza fara sa porneasca inca un interval.

## Teste si scripturi

Scripturile sunt TypeScript:

- `src/scripts/check-config.ts` valideaza config-ul.
- `src/scripts/check-syntax.ts` pica verificarea daca apare orice fisier `.js` in sursa `src`, ignorand output-ul generat din `dist` si loader-ul N-API `native/index.js`.

Teste importante:

- `src/test/commands-regression.test.ts` verifica regresiile pentru comenzi, notificari, runtime, module compilate si guard-urile RSS pentru drivere.
- `src/test/housekeeping.test.ts` verifica idempotenta `createHousekeeping().start()` si faptul ca `stop()` curata intervalul creat.
- `src/test/resolveOutboundChannel.test.ts` verifica comportamental erorile Discord permanente vs tranzitorii.
- `src/test/rustFuzzy.test.ts` verifica addon-ul Rust si contractul helperilor nativi.

## GitHub Actions

CI-ul real este in `.github/workflows/ci.yml`, fiindca GitHub nu ruleaza workflow-uri din `src/.github/workflows`.

Workflow-ul ruleaza pe push, pull request si pornire manuala, foloseste Node.js 20, instaleaza Rust stable, instaleaza dependintele in `src` si executa `npm run check`.
