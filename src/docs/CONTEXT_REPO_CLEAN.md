# Context repo curat

## Scopul proiectului

Repo-ul contine un bot Discord pentru notificari automate despre patch notes, update-uri de jocuri, reduceri Steam si Epic Games, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Codul sursa editabil este in `src` si este in principal TypeScript. JavaScript-ul apare dupa build in `src/dist/` si nu trebuie editat manual. Nucleul Rust este in `src/native` si este folosit pentru algoritmi puri de fuzzy matching, normalizare si hash-uri stabile.

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
      metrics.ts
      rateLimit.ts
      httpServer.ts
    lifecycle/
      events.ts
      shutdown.ts
    scheduler/
      cron.ts
      housekeeping.ts
  config/
    configLoader.ts
    configValidator.ts
  domain/
    deals/
      filters.ts
  features/
    commands/
      cache.ts
      index.ts
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
      index.ts
      locks.ts
      migrations.ts
      models.ts
      runtime.ts
      systemState.ts
  native/
    Cargo.toml
    build.rs
    fuzzy.ts
    package.json
    src/
      lib.rs
  scripts/
    check-config.ts
    check-syntax.ts
  shared/
    domain.ts
    env.ts
    errors.ts
    logging.ts
    utilities.ts
  sources/
    index.ts
    runtime.ts
    deals/
      index.ts
    steam/
      index.ts
    updates/
      index.ts
  test/
    buildOptimizedGameList.test.ts
    commands-regression.test.ts
    configValidator.test.ts
    dealHash.test.ts
    extractOfferEndFromHtml.test.ts
    findGameAndSuggestion.test.ts
    resolveOutboundChannel.test.ts
    rustFuzzy.test.ts
    safeCheerioLoad.test.ts
  docs/
  .gitignore
  config.json
  config.schema.json
  legacy-dynamic.d.ts
  package.json
  tsconfig.json
  types.ts
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

Scripturi importante:

- `npm run build:rust`: compileaza addon-ul Rust din `src/native`;
- `npm run build:ts`: compileaza TypeScript in `dist/`;
- `npm run build`: ruleaza Rust apoi TypeScript;
- `npm run typecheck`: ruleaza `tsc --noEmit`;
- `npm run check:syntax`: compileaza TypeScript si verifica faptul ca nu exista fisiere `.js` sursa ramase;
- `npm run check:config`: compileaza TypeScript si valideaza `config.json`;
- `npm test`: compileaza Rust + TypeScript si ruleaza testele din `dist/test`;
- `npm run check`: ruleaza typecheck, build, syntax check, config check si teste.

## Flow de pornire

`src/app/main.ts` este orchestratorul. Dupa build, se ruleaza ca `dist/app/main.js`.

Flow-ul:

1. `src/infra/mongo/index.ts` construieste contextul comun.
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

Regula curenta: sursa aplicatiei din `src` este TypeScript. Runtime-ul ramane CommonJS dupa compilare, deci importurile prin `require` si `module.exports` sunt acceptate unde ajuta la o migrare sigura.

`src/tsconfig.json`:

- compileaza doar `.ts` si `.d.ts` ca sursa;
- are `allowJs: false`, ca fisierele `.js` sa nu mai fie acceptate ca sursa editabila;
- foloseste `module: CommonJS`;
- foloseste `moduleDetection: force`, ca fisierele fara import explicit sa fie tratate ca module;
- exclude `dist`, `node_modules` si `coverage`.

`src/types.ts` pastreaza tipurile comune pentru config, env, metrics, cron, lifecycle, locks, HTTP, Mongo, surse, comenzi si date de domeniu.

`src/legacy-dynamic.d.ts` este un shim temporar pentru cateva obiecte legacy construite dinamic in fisierele mari convertite (`interactions.ts` si `notifications/index.ts`). Codul nou nu trebuie sa copieze acest model; pe masura ce aceste fisiere sunt tipizate mai strict, shim-ul poate fi redus sau eliminat.

## Rust

Rust este introdus gradual si doar unde are sens practic.

Module:

- `src/native/src/lib.rs`: implementeaza nativ `levenshtein`, `find_game_keys`, normalizarea pentru dedupe, ID-ul stabil de update, normalizarea starii unei reduceri si `deal_hash`;
- `src/native/fuzzy.ts`: incarca addon-ul `.node`, expune wrapper-ele TypeScript si pastreaza fallback-uri locale compatibile;
- `src/native/Cargo.toml`, `src/native/build.rs` si `src/native/package.json`: configuratia crate-ului N-API si metadata de build.

Unde este folosit acum:

- `src/sources/steam/index.ts` importa `levenshtein` din `src/native/fuzzy.ts`.
- `src/sources/index.ts` exporta mai departe `levenshtein` prin context.
- `src/features/commands/ui.ts` foloseste `levenshtein` din context pentru fuzzy matching-ul de comenzi, deci primeste implementarea Rust fara sa schimbe API-ul comenzii.
- `src/infra/http/client.ts` pastreaza `normalizeTitleForDedupe`, `stableUpdateId`, `normalizeDealState` si `dealHash`, dar acestea deleaga catre wrapper-ele Rust din `src/native/fuzzy.ts`.

Ce nu s-a mutat in Rust in acest pas:

- Discord handlers;
- Mongo queries si migrari;
- HTTP client, retries si proxy fallback;
- parsare HTML cu Cheerio;
- formatari de embed-uri.

Motiv: aceste zone sunt dominate de IO sau de obiecte Discord/Mongo, iar o conversie Rust acolo ar creste riscul mai mult decat performanta.

## Config si env

Config-ul runtime este in `src/config.json`, validat prin `src/config/configValidator.ts` si incarcat prin `src/config/configLoader.ts`.

Tipuri acceptate de surse:

- `steam`
- `minecraft`
- `epic_games`
- `roblox`
- `listing_based`
- `nvidia`
- `amd`
- `intel`

Variabilele de mediu sunt construite in `src/shared/env.ts`. In production, `/metrics` trebuie protejat prin `METRICS_TOKEN` sau facut public explicit cu `METRICS_PUBLIC=true`.

## MongoDB

MongoDB tine setari per guild, update-uri vazute, reduceri vazute, cozi pending, state global, locks distribuite, circuit breaker si cooldown-uri pentru alerte admin.

Module importante:

- `src/infra/mongo/runtime.ts`: dependinte comune pentru context;
- `src/infra/mongo/index.ts`: agregatorul infrastructurii Mongo;
- `src/infra/mongo/models.ts`: modelele `Guild`, `CircuitBreaker`, `System`, `JobLock`, `AdminAlertCooldown`;
- `src/infra/mongo/locks.ts`: lock-uri distribuite;
- `src/infra/mongo/migrations.ts`: migrari DB idempotente;
- `src/infra/mongo/systemState.ts`: timpi globali;
- `src/infra/mongo/guildSettings.ts`: cache guild settings;
- `src/infra/mongo/adminAlerts.ts`: alerte admin cu cooldown atomic.

## HTTP si sources

Clientul HTTP comun este in `src/infra/http/client.ts`. El gestioneaza retry/backoff, limite de bytes, user-agent random, proxy fallback, hashing, normalizare, in-flight coalescing si abort signal. Hashing-ul si normalizarile pure pentru dedupe sunt delegate catre `src/native/fuzzy.ts`, care foloseste Rust cand addon-ul nativ este disponibil.

Sursele externe sunt in `src/sources`:

- `runtime.ts`: dependinte comune pentru surse;
- `index.ts`: agregatorul surselor si exporturile tipate folosite de teste;
- `steam/index.ts`: cautare Steam, preturi, parser de expirare oferte si alegere best match folosind Levenshtein din Rust;
- `deals/index.ts`: reduceri Steam/Epic, enrich cache si review scoring;
- `updates/index.ts`: patch notes, listing-based scraping, circuit breaker si schema drift.

## Commands si notificari

Comenzile sunt in `src/features/commands`:

- `index.ts`: agregator;
- `cache.ts`: cache runtime, cooldown-uri si LRU;
- `ui.ts`: embed-uri, paginare, fuzzy matching, status si pret Steam;
- `slashCommands.ts`: definitii si inregistrare slash commands;
- `interactions.ts`: handler-ele slash si autocomplete.

Notificarile automate sunt in `src/features/notifications/index.ts`.

Reguli care nu trebuie rupte:

- claim atomic pentru `seen`;
- rollback cand Discord send esueaza;
- pending queues pentru update-uri si reduceri;
- activation id pentru `/start`;
- filtre per joc, store, pret si procent;
- ping de rol doar la prima notificare per ciclu;
- dezactivare canal pentru erori Discord permanente.

## Health si metrics

Pachetul health este in `src/app/health`:

- `metrics.ts`: creeaza contoarele runtime;
- `rateLimit.ts`: limiteaza `/health`, `/healthz` si `/metrics`;
- `httpServer.ts`: expune health, healthz si metrics.

`/health` include `cronHealth` cand cron controller-ul este disponibil. `/metrics` expune valori Prometheus-like si trebuie protejat in production.

## Teste si scripturi

Scripturile sunt TypeScript:

- `src/scripts/check-config.ts` valideaza config-ul;
- `src/scripts/check-syntax.ts` pica verificarea daca apare orice fisier `.js` in sursa `src`, ignorand output-ul generat din `dist` si loader-ul N-API `native/index.js`.

Testele sunt TypeScript:

- `src/test/buildOptimizedGameList.test.ts` verifica optimizarea listei de jocuri pentru cron;
- `src/test/commands-regression.test.ts` verifica regresiile pentru comenzi, notificari, runtime si module compilate;
- `src/test/configValidator.test.ts` verifica validatorul de config;
- `src/test/dealHash.test.ts` verifica stabilitatea hash-ului pentru reduceri;
- `src/test/extractOfferEndFromHtml.test.ts` verifica parser-ul datelor de expirare Steam;
- `src/test/findGameAndSuggestion.test.ts` verifica fuzzy matching-ul si cache-ul pentru jocuri;
- `src/test/rustFuzzy.test.ts` verifica faptul ca addon-ul Rust este incarcat, ca fuzzy matching-ul merge si ca hash-urile/normalizarile Rust pastreaza contractul existent;
- `src/test/safeCheerioLoad.test.ts` verifica taierea sigura a HTML-ului mare;
- `src/test/resolveOutboundChannel.test.ts` verifica comportamental ca erorile Discord permanente dezactiveaza canalul, iar cele tranzitorii (rate limit, 5xx, network) sar ciclul fara sa dezactiveze guild-ul.

## GitHub Actions

CI-ul real este in `.github/workflows/ci.yml`, fiindca GitHub nu ruleaza workflow-uri din `src/.github/workflows`.

Workflow-ul ruleaza pe push, pull request si pornire manuala, foloseste Node.js 20, instaleaza Rust stable, instaleaza dependintele in `src` si executa `npm run check`.
