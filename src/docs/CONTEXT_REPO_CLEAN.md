# Context repo curat

## Scopul proiectului

Acest repo contine un bot Discord pentru notificari automate despre update-uri/patch notes la jocuri, reduceri Steam si Epic Games, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Proiectul ruleaza pe Node.js si foloseste CommonJS la runtime-ul compilat. Codul este mixt JavaScript + TypeScript:

- modulele JavaScript raman in fisierele existente unde conversia ar fi riscanta sau inutila momentan;
- modulele unde tiparea aduce siguranta reala sunt scrise in TypeScript;
- `src/config/configValidator.ts` valideaza config-ul cu Zod;
- `src/config/configLoader.ts` incarca config-ul si returneaza `config`, `games` si `configPath` tipate;
- `src/shared/errors.ts`, `src/shared/logging.ts` si `src/shared/env.ts` contin baza comuna pentru erori, logger, request context si env;
- `src/app/scheduler/cron.ts` controleaza cron-ul critic cu tipuri explicite;
- `src/app/scheduler/housekeeping.ts` controleaza cleanup-ul periodic;
- `src/app/lifecycle/events.ts` si `src/app/lifecycle/shutdown.ts` tin event wiring-ul si oprirea controlata;
- `src/app/health/metrics.ts`, `src/app/health/rateLimit.ts` si `src/app/health/httpServer.ts` tin health/metrics intr-o zona TypeScript coerenta;
- `src/infra/mongo/locks.ts` gestioneaza lock-urile distribuite folosite de cron si migrari;
- `src/domain/deals/filters.ts`, `src/features/commands/cache.ts`, `src/features/commands/ui.ts` si `src/features/commands/slashCommands.ts` sunt TypeScript pentru regulile de domeniu si comenzi;
- `src/types.ts` pastreaza tipurile de domeniu si este folosit inclusiv de JSDoc-ul din modulele JavaScript;
- `npm start` compileaza cu TypeScript si porneste `dist/app/main.js`.

Rularea normala se face din `src/`:

```bash
npm start
```

Verificarea completa se face cu:

```bash
npm run check
```

## Structura principala

Aproape tot ce tine de proiect sta sub `src/`. Singura exceptie intentionata este workflow-ul GitHub Actions din `.github/workflows/ci.yml`, pentru ca GitHub ruleaza automat CI doar din acel folder special. Jobul CI lucreaza tot din `src/`.

```text
.github/
  workflows/
    ci.yml
src/
  app/
    main.js
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
      ui.ts
      slashCommands.ts
      interactions.js
    notifications/
  infra/
    http/
    mongo/
      locks.ts
  scripts/
  shared/
    env.ts
    errors.ts
    logging.ts
  sources/
  test/
  docs/
  config.json
  config.schema.json
  package.json
  tsconfig.json
  types.ts
```

`dist/` este output de build si nu trebuie editat manual.

## Flow de pornire

`src/app/main.js` ramane orchestrator. Dupa build, se executa ca `dist/app/main.js`.

Flow-ul:

1. `src/infra/mongo/index.js` construieste contextul comun, atasand `logging.ts`, `env.ts`, utilitare, modele, lock-uri si alerte;
2. incarca si valideaza config-ul prin `loadConfig` si `validateConfig`;
3. creeaza metricile;
4. conecteaza metricile la surse;
5. creeaza clientul Discord;
6. creeaza rate limiter-ul HTTP TypeScript;
7. creeaza housekeeping-ul TypeScript;
8. creeaza cron controller-ul TypeScript;
9. creeaza serverul HTTP TypeScript de health/metrics si ii da acces la starea cron;
10. creeaza controller-ul TypeScript de shutdown;
11. inregistreaza evenimente Discord si MongoDB prin lifecycle TypeScript;
12. conecteaza MongoDB;
13. ruleaza migrarile DB;
14. porneste serverul HTTP;
15. face login la Discord.

Logica mare nu trebuie pusa direct in `main.js`.

## TypeScript

TypeScript este folosit gradual. Regula curenta:

- conversia la `.ts` se face pentru module pure, critice sau usor de verificat;
- fisierele runtime mari raman JavaScript pana cand pot fi impartite/convertite fara risc;
- orice fisier `.ts` folosit de runtime trebuie sa mearga prin build, nu direct prin Node;
- importurile JSDoc din fisierele `.js` trebuie sa indice corect catre `src/types.ts`, pentru ca `npm run typecheck` le valideaza;
- `src/types.ts` trebuie actualizat cand se adauga env-uri, metrici, controllere, optiuni sau contracte intre module;
- `configValidator.ts` pastreaza accesul la erorile Zod intr-o forma tipata explicit, ca `safeParse` sa fie compatibil cu typecheck-ul curent;
- `configLoader.ts` descrie rezultatul de boot prin `ConfigLoadResult`;
- `src/shared/logging.ts` descrie `LoggerFunction`, `ParseEnvNumber`, `RequestContextStore` si semnalul de abort curent;
- `src/shared/env.ts` construieste obiectul `RuntimeEnv`, inclusiv placeholder handling pentru `METRICS_TOKEN`;
- `src/app/scheduler/cron.ts` este TypeScript fiindca gestioneaza lock distribuit, heartbeat, abort signal si health backoff;
- `src/app/lifecycle/*.ts` este TypeScript fiindca orice greseala aici poate afecta event wiring-ul sau oprirea controlata;
- `src/infra/mongo/locks.ts` este TypeScript fiindca gestioneaza lock token-uri si `activeLocks` folosite la shutdown;
- `src/app/health/*.ts` este TypeScript fiindca endpoint-urile de health/metrics ating env, metrics, cron controller, rate limiter si dependinte externe;
- `src/domain/deals/filters.ts`, `src/features/commands/cache.ts`, `src/features/commands/ui.ts` si `src/features/commands/slashCommands.ts` sunt TypeScript fiindca au reguli de business si cache-uri unde tipurile ajuta mult;
- `package.json` ruleaza build inainte de `start`, `test` si `check:config`.

Scripturi importante:

- `npm run build`: compileaza in `dist/`;
- `npm run typecheck`: ruleaza `tsc --noEmit`;
- `npm test`: compileaza si ruleaza testele din `dist/test`;
- `npm run check`: typecheck, build, syntax check, config check si teste.

## GitHub Actions

CI-ul real este in `.github/workflows/ci.yml`. Acesta este singurul fisier pastrat in afara `src`, deoarece GitHub Actions nu citeste workflow-uri din `src/.github/workflows`.

Workflow-ul ruleaza pe push, pull request si pornire manuala din GitHub Actions. Foloseste Node.js 20, instaleaza dependintele in `src/` si executa:

```bash
npm run check
```

Copia veche din `src/.github/workflows/ci.yml` a fost stearsa ca sa nu existe doua surse de adevar.

## Config

Config-ul runtime este in `src/config.json` si este incarcat de `src/config/configLoader.ts`, apoi validat in `src/config/configValidator.ts` cu Zod.

Tipuri acceptate de jocuri/surse:

- `steam`
- `minecraft`
- `epic_games`
- `roblox`
- `listing_based`
- `nvidia`
- `amd`
- `intel`

Validari importante:

- `checkIntervalMinutes` trebuie sa fie 10, 15, 30 sau 60;
- fiecare joc trebuie sa aiba `key` si `name`;
- jocurile Steam trebuie sa aiba `appId` numeric;
- sursele `listing_based` trebuie sa aiba `listingUrl` sau `listingUrls` si `baseUrl`;
- sursele Intel trebuie sa aiba `url`;
- `upCRD` este permis doar pentru NVIDIA;
- duplicatele de `key`, `name` sau `aliases` sunt respinse;
- `articleHrefRegex` trebuie sa fie regex valid.

Daca se adauga un tip nou de sursa, trebuie actualizate validatorul, `src/sources/updates/index.js`, `src/types.ts`, `src/config.schema.json` si testele.

## Env

Variabilele de mediu sunt validate in `src/shared/env.ts`, iar numerele sunt parse-uite prin `parseEnvNumber` din `src/shared/logging.ts`.

Campuri importante:

- `MONGO_URI`
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `PORT`
- `METRICS_TOKEN`
- `METRICS_PUBLIC`
- `ADMIN_WEBHOOK_URL`
- `LOG_LEVEL`
- `LOG_SAMPLE_RATE`
- `PROXY_URLS`
- `DEALS_CURRENCY_CACHE_MAX_SIZE`
- `GLOBAL_HEALTH_WINDOW`
- `GLOBAL_HEALTH_MIN_RATIO`
- `MONGO_RETRY_ATTEMPTS`
- `HTTP_RATE_LIMIT_REQ`
- `HTTP_RATE_LIMIT_WINDOW_MS`

In production, `/metrics` trebuie protejat prin `METRICS_TOKEN`, sau facut public explicit cu `METRICS_PUBLIC=true`. Placeholder-ul `change_me_to_a_long_random_value` este tratat ca lipsa.

## Logging si request context

`src/shared/logging.ts` creeaza `requestContext` prin `AsyncLocalStorage` si expune:

- `logger(level, context, message, meta)`;
- `parseEnvNumber(name, defaultValue, limits)`;
- `getAbortSignal()`.

Logger-ul poate scrie JSON sau text, include `requestId` cand exista si aplica sampling pe INFO/DEBUG prin `LOG_SAMPLE_RATE`. `getAbortSignal()` este folosit de clientul HTTP ca sa opreasca request-uri cand cron-ul este anulat.

## MongoDB

MongoDB este folosit pentru setari per server Discord, update-uri vazute, reduceri vazute, cozi pending, state global, locks distribuite, circuit breaker si cooldown-uri pentru alertele admin.

Modelele sunt in `src/infra/mongo/models.js`. Lock-urile distribuite sunt in `src/infra/mongo/locks.ts`. Migrarile sunt in `src/infra/mongo/migrations.js` si se ruleaza la pornire, dupa Mongo ready, sub lock distribuit.

`src/shared/utilities.js` expune `withMongoRetry` si `isTransientMongoError`. Claim-urile atomice din notificari folosesc retry doar pentru erori Mongo tranzitorii, nu pentru erori de logica.

## HTTP si scraping

Clientul HTTP comun este in `src/infra/http/client.js`. Acesta ofera retry/backoff, limite de bytes pentru HTML/JSON, user-agent random, proxy fallback, `safeCheerioLoad`, hashing pentru deal-uri, in-flight coalescing, timeout pentru promisiuni si agenti keep-alive.

Cron-ul pune `abortSignal` in `requestContext`, `src/shared/logging.ts` il expune prin `getAbortSignal`, iar `httpReq` il foloseste ca sa poata opri request-urile cand ciclul cron este anulat. Erorile de abort/cancel nu sunt retry-uite.

Acest fisier este sensibil: modificarile aici afecteaza toate sursele externe.

## Sources

Sursele externe sunt in `src/sources`.

- `src/sources/updates/index.js`: update-uri pentru Steam, Minecraft, Fortnite, Roblox, NVIDIA, AMD, Intel si surse `listing_based`;
- `src/sources/deals/index.js`: reduceri Steam si Epic Games;
- `src/sources/steam/index.js`: cautare Steam, preturi, alegere best match si extragere data expirarii ofertelor.

## Slash commands

Comenzile sunt in `src/features/commands`.

- `slashCommands.ts`: definitiile comenzilor;
- `interactions.js`: handler-ele slash/autocomplete;
- `ui.ts`: embed-uri, paginare, fuzzy matching si cache LRU pentru cautarea jocurilor;
- `cache.ts`: cache runtime, cooldown-uri si LRU pentru cache-ul de reduceri pe valute;
- `index.js`: agregator.

## Notificari automate

Notificarile automate sunt in `src/features/notifications/index.js`.

Reguli importante anti-spam si anti-duplicate:

- nu se strica logica de `seen`;
- nu se strica logica de `pending`;
- claim-ul trebuie atomic si trece prin `withMongoRetry`;
- rollback-ul trebuie pastrat;
- limitele per ciclu trebuie pastrate;
- rolul se ping-uieste doar la prima notificare per ciclu;
- `updatesInitializing` si `discountsInitializing` protejeaza activarea;
- activation id previne race conditions la `/start`;
- cron-ul foloseste `buildOptimizedGameList` ca sa evite scraping-ul jocurilor nefolosite;
- erorile Discord permanente `10003`, `10004`, `50001`, `50013` dezactiveaza canalul afectat in loc sa produca retry-uri infinite.

## Health si metrics

Pachetul health este TypeScript:

- `src/app/health/metrics.ts` creeaza obiectul de metrici runtime;
- `src/app/health/rateLimit.ts` limiteaza endpoint-urile `/health`, `/healthz` si `/metrics` pe IP si accepta `x-forwarded-for` atat string, cat si array;
- `src/app/health/httpServer.ts` creeaza serverul HTTP si expune endpoint-urile.

Endpoint-uri:

- `/health`
- `/healthz`
- `/metrics`

`/health` include `cronHealth` cand serverul primeste cron controller-ul. Cron-ul calculeaza rata de succes pe o fereastra scurta si poate sari un ciclu daca rata scade sub `GLOBAL_HEALTH_MIN_RATIO`.

Cron-ul prinde si erorile aparute la obtinerea lock-ului. Acestea cresc `cronErrors`, intra in health window, trimit alerta `cron:lock` si programeaza urmatorul ciclu in loc sa opreasca scheduler-ul.

`/metrics` expune metrici Prometheus-like si trebuie protejat in production. Contorul `bot_cron_skipped_due_to_health` arata cate cicluri au fost sarite din cauza backoff-ului global.

## Teste si scripturi

Scripturi:

- `src/scripts/check-config.js`: se ruleaza din `dist/scripts/check-config.js` dupa build;
- `src/scripts/check-syntax.js`: verifica sintaxa fisierelor JavaScript sursa si ignora `dist/`.

Teste importante:

- regresii pentru comenzi si notificari;
- protectiile portate din codul local: retry Mongo, coduri Discord permanente, cache LRU pe valute, cron health, abort signal HTTP si eroare la lock cron;
- regresie pentru pachetul health compilat din TypeScript;
- regresie pentru modulele boot/lifecycle/lock compilate din TypeScript;
- regresie pentru modulele shared env/logging compilate din TypeScript;
- validare config;
- hashing reduceri;
- fuzzy matching jocuri;
- parsing Steam offer end;
- `safeCheerioLoad`;
- optimizarea listei de jocuri pentru cron.
