# Discord Patch Bot

[![CI](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml)
[![Dependency Audit](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-audit.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-audit.yml)
[![CodeQL](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/codeql.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/codeql.yml)
[![Release](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/release.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/release.yml)
![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Discord Patch Bot trimite automat pe servere Discord notificari despre patch notes, update-uri de jocuri, reduceri Steam/Epic, preturi Steam, DLC-uri, status servere si health/metrics.

Repo-ul este organizat in jurul sursei din `src/`, cu TypeScript strict si un mic modul Rust/N-API pentru algoritmi puri de fuzzy matching, normalizare si hashing.

## Cerinte

- Node.js 20 sau mai nou
- npm 10 sau mai nou
- Rust stable si toolchain Cargo, necesare pentru addon-ul N-API
- MongoDB 6/7 sau un MongoDB Atlas compatibil
- Un Discord bot token si application/client ID din Discord Developer Portal

## Setup local

```bash
cd src
npm ci
cp .env.example .env
```

Completeaza in `src/.env` cel putin:

```bash
MONGO_URI=mongodb://localhost:27017/discord-patch-bot
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
METRICS_PUBLIC=true
```

`src/.env.example` documenteaza si variabilele optionale importante: metrics token, reverse proxy, admin webhook, proxy URL templates, limite de scraping, cooldown-uri Discord, circuit breaker, pending queues, cache-uri, Mongo pool si rate limit pentru endpoint-urile HTTP.

## Comenzi utile

Din `src/`:

```bash
npm run build       # compileaza Rust/N-API si TypeScript
npm start           # porneste codul deja compilat din dist/app/main.js
npm run dev         # build + start pentru dezvoltare locala
npm run check       # typecheck, build, syntax/config/dependency check si teste
npm run test        # build + testele Node
npm run lint        # typecheck normal + strict
npm run audit       # audit pe dependintele runtime
```

`npm start` nu mai ruleaza build automat. In productie, build-ul trebuie facut in CI sau in imaginea Docker, iar runtime-ul doar porneste `dist/app/main.js`.

## Docker Compose

Din radacina repo-ului:

```bash
cp src/.env.example src/.env
# editeaza DISCORD_TOKEN si DISCORD_CLIENT_ID

docker compose up --build
```

Compose porneste botul si MongoDB intr-o retea interna Docker. Mongo nu este publicat pe host; botul publica HTTP doar pe `127.0.0.1:3000`, ca endpoint-urile locale sa nu fie expuse accidental in retea.

Imaginea runtime din `Dockerfile` ruleaza procesul ca user non-root `node`, dupa ce fisierele din `/app` primesc ownership corect. Pastreaza acest lucru si pentru imaginile publicate in GHCR.

## Dependinte si audit

Dependintele sunt blocate prin `src/package-lock.json`, iar CI instaleaza cu `npm ci`.

- `npm run audit` ruleaza local auditul pe dependintele runtime.
- `npm run check:dependencies` verifica local ca dependintele runtime si build/dev directe sunt pin-uite exact, ca intrarile directe din lockfile rezolva la aceleasi versiuni si ca URL-urile din lockfile folosesc registry npm peste HTTPS.
- `.github/workflows/dependency-audit.yml` ruleaza saptamanal acelasi audit in GitHub Actions si poate fi pornit manual.
- `.github/workflows/dependency-review.yml` ruleaza pe PR-uri si devine blocant pentru vulnerabilitati moderate sau mai grave cand GitHub Dependency graph este activ.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript la push, PR, saptamanal si manual.
- `.github/dependabot.yml` deschide PR-uri saptamanale pentru dependinte npm din `src` si pentru GitHub Actions.

## Release si versioning

Versiunile folosesc tag-uri semver de forma `vMAJOR.MINOR.PATCH`, de exemplu `v1.0.0` sau `v1.1.0`.

Proces recomandat:

1. Actualizeaza `CHANGELOG.md` cu modificarile pentru versiunea noua.
2. Da merge in `main` dupa ce CI este verde.
3. Creeaza si impinge tag-ul, de exemplu `v1.0.0` pentru primul release public sau `v1.1.0` pentru urmatorul minor.
4. `.github/workflows/release.yml` ruleaza `npm run check` din `src`, extrage doar sectiunea versiunii din `CHANGELOG.md`, publica imaginea Docker in GitHub Container Registry si creeaza GitHub Release.

Imaginea Docker publicata are formatul:

```text
ghcr.io/ciobotaruandrei/discord-patch-bot:v1.0.0
ghcr.io/ciobotaruandrei/discord-patch-bot:latest
```

## Securitate

Repo-ul are `SECURITY.md` pentru raportarea privata a vulnerabilitatilor. Nu publica in issue-uri tokenuri Discord, credentiale Mongo, `METRICS_TOKEN`, webhook-uri sau proxy URL-uri. Pentru probleme de securitate foloseste GitHub Security Advisories.

CodeQL este configurat prin `.github/workflows/codeql.yml` pentru analiza JavaScript/TypeScript. Secret scanning si push protection se activeaza din setarile GitHub ale repo-ului; `SECURITY.md` documenteaza ce se verifica si ce trebuie rotit daca un secret ajunge public.

Comenzile admin (`/start`, `/stop`, `/set`) sunt protejate si la runtime prin `features/command-security/adminCommandRouterGuard.ts`, nu doar prin metadata de slash command. Asta reduce riscul daca permisiunile Discord sunt schimbate sau suprascrise pe server.

## Config jocuri

Lista de jocuri si surse este in `src/config.json`. Fiecare intrare are o cheie (`key`) folosita in comenzi Discord si un tip de sursa, de exemplu `steam`, `epic_games`, `listing_based`, `nvidia`, `amd` sau `intel`.

## Comenzi Discord

Comenzile sunt inregistrate ca slash commands. Suprafata principala include:

- `/start updates` si `/stop updates` pentru update-uri automate
- `/start reduceri` si `/stop reduceri` pentru reduceri automate
- `/latest updates`, `/latest update`, `/latest reduceri` si `/latest pret`
- `/set games`, `/set stores`, `/set role`, `/set mode`, `/set currency`, `/set mindiscount`, `/set maxprice`
- `/games`, `/help`, `/ping`

## Exemple embed-uri

Aceste mock-uri statice arata forma mesajelor trimise in Discord pentru cele mai importante fluxuri.

| `/help` | Update automat | Reducere automata |
| --- | --- | --- |
| <img src="docs/assets/embed-help.svg" alt="Exemplu embed /help" width="240"> | <img src="docs/assets/embed-update.svg" alt="Exemplu embed update" width="240"> | <img src="docs/assets/embed-discount.svg" alt="Exemplu embed reducere" width="240"> |

## Health si metrics

Serverul HTTP expune:

- `/health` si `/healthz` pentru health checks
- `/metrics` pentru Prometheus-style metrics

In productie `/metrics` trebuie protejat cu `METRICS_TOKEN`, exceptand cazul in care setezi explicit `METRICS_PUBLIC=true`.

## Structura

```text
.github/dependabot.yml
.github/workflows/
CHANGELOG.md
Dockerfile
docker-compose.yml
docs/assets/
LICENSE
SECURITY.md
src/
  app/
  config/
  domain/
  features/
    command-cache/          # cache runtime, cooldown-uri si LRU
    command-definitions/    # definitii si inregistrare slash commands
    command-handlers/       # handlers/factory-uri extrase: help, start/stop, set games, set role
    command-presentation/   # embed-uri, paginare, fuzzy matching, status si preturi
    command-registry/       # wiring-ul comenzilor si contractul installer-elor
    command-router/         # routerul legacy ramas pentru /latest, /dlc, /status si autocomplete
    command-runtime/        # dependintele runtime injectate in comenzi
    command-security/       # runtime admin guard si wrapper pentru comenzi protejate
    notifications/
  infra/http/
  infra/mongo/
  native/
  scripts/
  sources/
  test/
```

`dist/`, `node_modules/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output-uri generate si nu se editeaza manual.

## Testare

`npm run check` este verificarea completa folosita si in CI. Pe langa regresii textuale, repo-ul are teste functionale cu mock-uri pentru zone critice:

- Flux E2E `/start updates -> baseline Mongo -> cron -> embed -> seen` in `startUpdatesFlow.e2e.test.ts`
- Flux E2E `/start reduceri -> baseline reduceri -> cron -> deal embed -> seenDiscounts` in `startDiscountsFlow.e2e.test.ts`
- Factory-ul pentru `/start` si `/stop` in `subscriptionInteractions.functional.test.ts`
- Factory-ul pentru `/set games` in `gameFilterInteractions.functional.test.ts`
- Factory-ul pentru `/set role` in `rolePingInteractions.functional.test.ts`
- Handler-ul extras pentru `/help` in `helpHandler.functional.test.ts`
- Runtime admin guard pentru `/start`, `/stop` si `/set` in `adminGuard.test.ts`
- Release notes extraction pentru GitHub Releases in `extractReleaseNotes.test.ts`
- Discord channel resolution si erori permanente in `resolveOutboundChannel.test.ts`
- `/set games add/remove` in `setGamesInteraction.functional.test.ts`
- HTTP URL safety si proxy fallback in `httpClientSecurity.test.ts`
- Mongo migrations si lock release in `mongoMigrations.functional.test.ts`
- Command registry wiring in `commandRegistry.functional.test.ts`
- Source registry wiring in `sourceRegistry.functional.test.ts`
- Filtrele de reduceri exportate direct in `dealFiltersCore.functional.test.ts`

CI confirma logica prin teste cu mock-uri si fluxuri E2E locale. Comportamentul live complet trebuie validat separat pe un server Discord de staging, cu `DISCORD_TOKEN`, Mongo si surse externe reale, inainte de un release public.

## Note arhitecturale

Codul legacy foloseste inca module CommonJS care ataseaza functii pe un context comun. Pentru a reduce riscul, migrarea se face treptat:

- `command-registry/commandRegistry.ts` expune o fabrica testabila cu installer-e injectate explicit.
- `command-definitions/slashCommandDefinitions.ts` este inclus in strict TypeScript si foloseste tipuri locale pentru builder-ele Discord.
- `command-security/adminCommandRouterGuard.ts` impune runtime admin check pentru `/start`, `/stop` si `/set` inainte de delegarea catre handler-ele concrete.
- `command-handlers/helpInteractionHandler.ts` extrage `/help` intr-un handler mic si testabil.
- `command-handlers/subscriptionNotificationHandlers.ts` extrage fluxurile `/start` si `/stop` intr-o factory tipata cu dependinte explicite.
- `command-handlers/gameFilterHandlers.ts` extrage fluxurile `/set games` intr-o factory tipata cu dependinte explicite.
- `command-handlers/rolePingHandlers.ts` extrage fluxurile `/set role updates/discounts` intr-o factory tipata cu dependinte explicite.
- `command-router/legacyInteractionRouter.ts` pastreaza temporar rutele inca neextrase (`/latest`, `/dlc`, `/status`, autocomplete), dar le tine intr-un folder numit dupa functionalitate, nu in vechiul folder plat `commands`.
- `domain/deals/filtersCore.ts` expune reguli pure si tipate direct, iar `domain/deals/filters.ts` ramane doar adapter pentru contextul legacy.
- `features/notifications/outboundChannel.ts` expune resolver-ul tipat pentru canale Discord, iar `features/notifications/index.ts` il foloseste ca serviciu injectat.

Urmatorii pasi pot muta cate o comanda din `features/command-router/legacyInteractionRouter.ts` (`latest`, `dlc`, `status`, autocomplete) catre handlers/factory-uri mai tipate, fara sa schimbe toate fluxurile intr-un singur PR.

## Licenta

Codul este publicat sub licenta MIT. Vezi [LICENSE](LICENSE).
