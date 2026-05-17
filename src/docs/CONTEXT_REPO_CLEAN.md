# Context repo curat

## Scopul proiectului

Acest repo contine un bot Discord pentru notificari automate despre:

- update-uri si patch notes la jocuri;
- reduceri Steam si Epic Games;
- preturi curente Steam;
- DLC-uri Steam;
- status servere pentru anumite jocuri sau platforme;
- health checks si metrici pentru rulare/deploy.

Proiectul este scris in Node.js cu CommonJS (`require` / `module.exports`). Foloseste `discord.js`, `mongoose`, `axios`, `cheerio`, `rss-parser`, `zod` si TypeScript doar pentru verificari/tipuri.

Entry point-ul aplicatiei este `src/app/main.js`, iar rularea normala se face din `src/` cu `npm start`.

## Structura principala

Tot ce tine de proiect sta sub `src/`:

```text
src/
  app/
    main.js
    health/
    lifecycle/
    scheduler/
  config/
  domain/
  features/
    commands/
    notifications/
  infra/
    http/
    mongo/
  scripts/
  shared/
  sources/
  test/
  config.json
  package.json
  tsconfig.json
  types.ts
```

## Flow de pornire

`src/app/main.js` trebuie pastrat ca orchestrator. El:

1. incarca si valideaza config-ul;
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

## Config

Config-ul runtime este in `src/config.json` si este validat in `src/config/configValidator.js` cu Zod.

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

Daca se adauga un tip nou de sursa, trebuie actualizate validatorul, `src/sources/updates/index.js`, `src/types.ts` si testele.

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
- `PROXY_URLS`

In production, `/metrics` trebuie protejat prin `METRICS_TOKEN`, sau facut public explicit cu `METRICS_PUBLIC=true`.

## MongoDB

MongoDB este folosit pentru:

- setari per server Discord;
- update-uri vazute;
- reduceri vazute;
- cozi de update-uri pending;
- cozi de reduceri pending;
- state global pentru estimari de timp;
- locks distribuite pentru cron si migrari;
- circuit breaker pentru surse externe;
- cooldown-uri pentru alertele admin.

Modelele sunt in `src/infra/mongo/models.js`.

## HTTP si scraping

Clientul HTTP comun este in `src/infra/http/client.js`. Acesta ofera request-uri cu retry/backoff, limite de bytes pentru HTML/JSON, user-agent random, proxy fallback, `safeCheerioLoad`, normalizare update-uri, hashing pentru deal-uri, coalescing pentru request-uri in zbor si timeout pentru promisiuni.

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
- `ui.js`: embed-uri, paginare, fuzzy matching;
- `cache.js`: cache runtime si cooldown-uri;
- `index.js`: agregator.

Comenzi principale: `/ping`, `/games`, `/help`, `/start`, `/stop`, `/set`, `/latest`, `/dlc`, `/status`.

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
- activation id previne race conditions la `/start`.

## Health si metrics

Serverul HTTP este in `src/app/health/httpServer.js`.

Endpoint-uri:

- `/health`
- `/healthz`
- `/metrics`

`/metrics` expune metrici Prometheus-like si trebuie protejat in production.

## Scheduler si shutdown

Cron-ul este in `src/app/scheduler/cron.js`. Foloseste lock distribuit `cron_main`, heartbeat pentru lock, `AbortController`, metrici si reprogrameaza urmatorul ciclu.

Shutdown-ul este in `src/app/lifecycle/shutdown.js`. El opreste cron-ul si housekeeping-ul, elibereaza lock-urile, asteapta drain, distruge clientul Discord, inchide Mongo si serverul HTTP.

## Teste si scripturi

Scripturi:

- `src/scripts/check-config.js`
- `src/scripts/check-syntax.js`

Teste existente si recomandate:

- regresii pentru comenzi si notificari;
- validare config;
- hashing reduceri;
- fuzzy matching jocuri;
- parsing Steam offer end;
- `safeCheerioLoad`;
- optimizarea listei de jocuri pentru cron.

Comanda completa este `npm run check`, rulata din `src/`.