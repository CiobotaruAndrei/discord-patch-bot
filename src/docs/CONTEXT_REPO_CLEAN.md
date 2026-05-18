# Context repo curat

## Scopul proiectului

Repo-ul contine un bot Discord pentru notificari automate despre patch notes, update-uri de jocuri, reduceri Steam si Epic Games, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Codul sursa editabil este in `src` si este TypeScript. JavaScript-ul apare dupa build in `src/dist/` si nu trebuie editat manual.

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
    commands-regression.test.ts
    configValidator.test.ts
  docs/
  config.json
  config.schema.json
  legacy-dynamic.d.ts
  package.json
  tsconfig.json
  types.ts
```

`dist/` este output de build si nu se editeaza manual.

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

- `npm run build`: compileaza TypeScript in `dist/`;
- `npm run typecheck`: ruleaza `tsc --noEmit`;
- `npm run check:syntax`: compileaza si ruleaza `dist/scripts/check-syntax.js`;
- `npm run check:config`: compileaza si valideaza `config.json`;
- `npm test`: compileaza si ruleaza testele din `dist/test`;
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

Logica mare nu trebuie pusa direct in `main.ts`; ea sta in modulele din `app`, `features`, `infra`, `shared` si `sources`.

## TypeScript

Regula curenta este simpla: sursa din `src` este TypeScript. Runtime-ul ramane CommonJS dupa compilare, deci importurile prin `require` si `module.exports` sunt acceptate unde ajuta la o migrare sigura.

`src/tsconfig.json`:

- compileaza `.ts` si, pentru compatibilitate, inca permite `.js` prin `allowJs`;
- foloseste `module: CommonJS`;
- foloseste `moduleDetection: force`, ca fisierele fara import explicit sa fie tratate ca module;
- exclude `dist`, `node_modules` si `coverage`.

`src/types.ts` pastreaza tipurile comune pentru config, env, metrics, cron, lifecycle, locks, HTTP, Mongo, surse, comenzi si date de domeniu.

`src/legacy-dynamic.d.ts` este un shim temporar pentru cateva obiecte legacy construite dinamic in fisierele mari convertite (`interactions.ts` si `notifications/index.ts`). Codul nou nu trebuie sa copieze acest model; pe masura ce aceste fisiere sunt tipizate mai strict, shim-ul poate fi redus sau eliminat.

`src/features/commands/index.ts` seteaza temporar `fetchGameStatus` pe `globalThis` pentru compatibilitate cu handler-ul legacy convertit. TypeScript a prins aici un bug care exista in JS: `/status` folosea `fetchGameStatus` fara sa fie disponibil in scope.

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

Clientul HTTP comun este in `src/infra/http/client.ts`. El gestioneaza retry/backoff, limite de bytes, user-agent random, proxy fallback, hashing, normalizare, in-flight coalescing si abort signal.

Sursele externe sunt in `src/sources`:

- `runtime.ts`: dependinte comune pentru surse;
- `index.ts`: agregatorul surselor si exporturile tipate folosite de teste;
- `steam/index.ts`: cautare Steam, preturi si parser de expirare oferte;
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
- `src/scripts/check-syntax.ts` ruleaza syntax check pe fisiere `.js` sursa ramase. In starea curenta ar trebui sa gaseasca zero fisiere JavaScript sursa, in afara de output-ul ignorat din `dist`.

Testele sunt TypeScript:

- `src/test/commands-regression.test.ts` verifica regresiile pentru comenzi, notificari, runtime si module compilate;
- `src/test/configValidator.test.ts` verifica validatorul de config.

## GitHub Actions

CI-ul real este in `.github/workflows/ci.yml`, fiindca GitHub nu ruleaza workflow-uri din `src/.github/workflows`.

Workflow-ul ruleaza pe push, pull request si pornire manuala, foloseste Node.js 20, instaleaza dependintele in `src` si executa `npm run check`.
