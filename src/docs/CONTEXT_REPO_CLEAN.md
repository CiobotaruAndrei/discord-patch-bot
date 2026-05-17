# Context repo curat

## Scopul proiectului

Acest repo contine un bot Discord pentru notificari automate despre update-uri/patch notes la jocuri, reduceri Steam si Epic Games, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Proiectul ruleaza pe Node.js si foloseste CommonJS la runtime-ul compilat. Codul este mixt JavaScript + TypeScript:

- modulele JavaScript raman in fisierele existente unde conversia ar fi riscanta sau inutila momentan;
- modulele unde tiparea aduce siguranta reala sunt scrise in TypeScript;
- `src/config/configValidator.ts` valideaza config-ul cu Zod;
- `src/shared/errors.ts` contine helper-ele comune pentru erori;
- `src/types.ts` pastreaza tipurile de domeniu;
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
    lifecycle/
    scheduler/
  config/
    configLoader.js
    configValidator.ts
  domain/
  features/
    commands/
    notifications/
  infra/
    http/
    mongo/
  scripts/
  shared/
    errors.ts
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

1. incarca si valideaza config-ul prin `loadConfig` si `validateConfig`;
2. creeaza metricile;
3. conecteaza metricile la surse;
4. creeaza clientul Discord;
5. creeaza rate limiter-ul HTTP;
6. creeaza housekeeping-ul;
7. creeaza cron controller-ul;
8. creeaza serverul HTTP de health/metrics;
9. creeaza controller-ul de shutdown;
10. inregistreaza evenimente Discord si MongoDB;
11. conecteaza MongoDB;
12. ruleaza migrarile DB;
13. porneste serverul HTTP;
14. face login la Discord.

Logica mare nu trebuie pusa direct in `main.js`.

## TypeScript

TypeScript este folosit gradual. Regula curenta:

- conversia la `.ts` se face pentru module pure, critice sau usor de verificat;
- fisierele runtime mari raman JavaScript pana cand pot fi impartite/convertite fara risc;
- orice fisier `.ts` folosit de runtime trebuie sa mearga prin build, nu direct prin Node;
- `package.json` ruleaza build inainte de `start`, `test` si `check:config`.

Scripturi importante:

- `npm run build`: compileaza in `dist/`;
- `npm run typecheck`: ruleaza `tsc --noEmit`;
- `npm test`: compileaza si ruleaza testele din `dist/test`;
- `npm run check`: typecheck, build, syntax check, config check si teste.

## GitHub Actions

CI-ul real este in `.github/workflows/ci.yml`. Acesta este singurul fisier pastrat in afara `src`, deoarece GitHub Actions nu citeste workflow-uri din `src/.github/workflows`.

Workflow-ul ruleaza pe push si pull request, foloseste Node.js 20, instaleaza dependintele in `src/` si executa:

```bash
npm run check
```

Copia veche din `src/.github/workflows/ci.yml` a fost stearsa ca sa nu existe doua surse de adevar.

## Config

Config-ul runtime este in `src/config.json` si este validat in `src/config/configValidator.ts` cu Zod.

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

Variabilele de mediu sunt validate in `src/shared/env.js`.

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

In production, `/metrics` trebuie protejat prin `METRICS_TOKEN`, sau facut public explicit cu `METRICS_PUBLIC=true`. Placeholder-ul `change_me_to_a_long_random_value` este tratat ca lipsa.

## MongoDB

MongoDB este folosit pentru setari per server Discord, update-uri vazute, reduceri vazute, cozi pending, state global, locks distribuite, circuit breaker si cooldown-uri pentru alertele admin.

Modelele sunt in `src/infra/mongo/models.js`. Migrarile sunt in `src/infra/mongo/migrations.js` si se ruleaza la pornire, dupa Mongo ready, sub lock distribuit.

## HTTP si scraping

Clientul HTTP comun este in `src/infra/http/client.js`. Acesta ofera retry/backoff, limite de bytes pentru HTML/JSON, user-agent random, proxy fallback, `safeCheerioLoad`, hashing pentru deal-uri, in-flight coalescing, timeout pentru promisiuni si agenti keep-alive.

Acest fisier este sensibil: modificarile aici afecteaza toate sursele externe.

## Sources

Sursele externe sunt in `src/sources`.

- `src/sources/updates/index.js`: update-uri pentru Steam, Minecraft, Fortnite, Roblox, NVIDIA, AMD, Intel si surse `listing_based`;
- `src/sources/deals/index.js`: reduceri Steam si Epic Games;
- `src/sources/steam/index.js`: cautare Steam, preturi, alegere best match si extragere data expirarii ofertelor.

## Slash commands

Comenzile sunt in `src/features/commands`.

- `slashCommands.js`: definitiile comenzilor;
- `interactions.js`: handler-ele slash/autocomplete;
- `ui.js`: embed-uri, paginare, fuzzy matching si cache LRU pentru cautarea jocurilor;
- `cache.js`: cache runtime si cooldown-uri;
- `index.js`: agregator.

## Notificari automate

Notificarile automate sunt in `src/features/notifications/index.js`.

Reguli importante anti-spam si anti-duplicate:

- nu se strica logica de `seen`;
- nu se strica logica de `pending`;
- claim-ul trebuie atomic;
- rollback-ul trebuie pastrat;
- limitele per ciclu trebuie pastrate;
- rolul se ping-uieste doar la prima notificare per ciclu;
- `updatesInitializing` si `discountsInitializing` protejeaza activarea;
- activation id previne race conditions la `/start`;
- cron-ul foloseste `buildOptimizedGameList` ca sa evite scraping-ul jocurilor nefolosite.

## Health si metrics

Serverul HTTP este in `src/app/health/httpServer.js`.

Endpoint-uri:

- `/health`
- `/healthz`
- `/metrics`

`/metrics` expune metrici Prometheus-like si trebuie protejat in production.

## Teste si scripturi

Scripturi:

- `src/scripts/check-config.js`: se ruleaza din `dist/scripts/check-config.js` dupa build;
- `src/scripts/check-syntax.js`: verifica sintaxa fisierelor JavaScript sursa si ignora `dist/`.

Teste importante:

- regresii pentru comenzi si notificari;
- validare config;
- hashing reduceri;
- fuzzy matching jocuri;
- parsing Steam offer end;
- `safeCheerioLoad`;
- optimizarea listei de jocuri pentru cron.
