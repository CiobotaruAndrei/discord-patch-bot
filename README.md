# Discord Patch Bot

[![CI](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml)
[![Dependency Audit](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-review.yml)
![Node](https://img.shields.io/badge/node-20.x-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-strict%20incremental-3178c6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/docker-GHCR%20ready-2496ed?logo=docker&logoColor=white)

Bot Discord pentru notificari despre update-uri, DLC-uri si reduceri pentru jocuri urmarite. Proiectul ruleaza pe Node.js/TypeScript, foloseste MongoDB pentru persistenta si include guard-uri pentru scraping fragil, rate limiting, health checks, metrics si deployment cu Docker.

## Ce face botul

- Monitorizeaza jocuri configurate per server Discord.
- Trimite notificari pentru update-uri noi si reduceri relevante.
- Expune comenzi slash pentru abonare, configurare, verificari manuale si status.
- Evita duplicatele prin `seenUpdates` si `seenDiscounts` persistate in MongoDB.
- Are fallback-uri si circuit breaker pentru surse externe fragile.
- Expune endpoint-uri locale `/healthz` si `/metrics`.

## Comenzi principale

- `/start updates` - activeaza notificarile de update-uri pentru server.
- `/start reduceri` - activeaza notificarile de reduceri pentru server.
- `/stop updates` - dezactiveaza notificarile de update-uri.
- `/stop reduceri` - dezactiveaza notificarile de reduceri.
- `/set games add` - adauga jocuri urmarite.
- `/set games remove` - elimina jocuri urmarite.
- `/set game-state` - seteaza manual starea unui joc.
- `/latest` - afiseaza ultimele update-uri cunoscute.
- `/dlc` - afiseaza DLC-uri cunoscute.
- `/status` - afiseaza starea botului pentru server.
- `/help` - afiseaza paginile de ajutor.

Comenzile administrative sunt validate atat prin permisiunile slash command declarate in Discord, cat si prin verificari runtime in handler-ele sensibile.

## Cerinte

- Node.js 20.x
- npm 10+
- MongoDB 7+ sau Docker Compose
- Token Discord si aplicatie Discord configurata cu slash commands

## Setup rapid

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

Pentru development local cu MongoDB inclus:

```bash
docker compose up --build
```

MongoDB ruleaza doar in reteaua interna Docker; botul se conecteaza prin `MONGODB_URI`.

## Variabile de mediu

Fisierul `.env.example` documenteaza variabilele importante. Cele minime pentru rulare sunt:

```env
DISCORD_TOKEN=...
CLIENT_ID=...
MONGODB_URI=mongodb://mongo:27017/discord-patch-bot
```

Variabile utile suplimentare:

- `GUILD_ID` - optional, pentru comenzi guild-scoped in development.
- `CRON_INTERVAL_MS` - intervalul de verificare pentru update-uri.
- `DISCOUNT_CRON_INTERVAL_MS` - intervalul de verificare pentru reduceri.
- `HEALTH_PORT` - portul serverului local de health/metrics.
- `METRICS_TOKEN` - token optional pentru acces la `/metrics`.
- `LOG_LEVEL` - nivelul de logging.
- `PROXY_URL` - proxy HTTP optional pentru surse externe.

## Structura proiectului

```text
src/
  app/
    main.ts                 # bootstrap bot
    health/httpServer.ts    # /healthz si /metrics
  config/                   # env, validari si setari runtime
  db/                       # conexiune MongoDB si modele Mongoose
  features/
    commands/               # registru si runtime pentru slash commands
    command-handlers/       # handler-e tipate pentru comenzi si autocomplete
    notifications/          # wiring notificari, seen repo, servicii update/reduceri
    scrapers/               # surse externe si parsere
    sources/                # registry si fallback-uri pentru surse
  jobs/                     # cron jobs pentru update-uri si reduceri
  lib/                      # utilitare comune
  docs/                     # harti de context si functie
src/native/                 # optional Rust/N-API pentru operatii hot-path
.github/workflows/          # CI, audit, dependency review, release
```

Nu mai exista un `command-router` activ ca structura curenta. Handler-ele cunoscute sunt in `src/features/command-handlers/`, iar `fallbackInteractionHandler.ts` ramane doar ca fallback de final pentru interactiuni necunoscute sau neacoperite explicit.

## Testare

```bash
npm test
npm run test:functional
npm run test:e2e
npm run typecheck
npm run typecheck:strict
npm run build
npm audit
```

Testele acopera zonele importante:

- validare env si configuratie;
- registrul de comenzi si guard-uri anti-regresie;
- handler-e functionale pentru `/help`, `/ping`, `/games`, `/set`, `/latest`, `/dlc`, `/status` si autocomplete;
- servicii de notificari pentru update-uri si reduceri;
- repository-ul `seen` pentru deduplicare;
- fluxuri E2E pentru update-uri si reduceri;
- parsere, filtre, circuit breaker, cooldown-uri si rate limiting.

Testele care folosesc surse externe reale nu confirma comportament live cu token Discord real. Pentru productie, valideaza si cu un server Discord de test si MongoDB real.

## Build, start si release

Build-ul si start-ul sunt separate:

```bash
npm run build
npm start
```

`npm start` ruleaza codul deja compilat din `dist/`. In productie, build-ul trebuie facut in CI, Docker image sau pipeline separat.

Workflow-ul de release poate publica un GitHub Release si o imagine Docker pe GitHub Container Registry cand este impins un tag `v*`.

## Docker

```bash
docker compose up --build
```

Imaginea este multi-stage, instaleaza dependintele cu `npm ci`, compileaza proiectul si ruleaza procesul Node ca user non-root.

## Note arhitecturale

Proiectul este intr-o migrare controlata dintr-un stil vechi CommonJS/context comun spre handler-e si servicii cu dependinte explicite.

Starea curenta:

- handler-ele pentru comenzi cunoscute sunt separate in `src/features/command-handlers/`;
- `interactions.ts` este router/wiring si delega catre handler-e;
- `notifications/index.ts` este wiring pentru cron jobs, iar logica principala este in `updateNotificationService.ts` si `discountNotificationService.ts`;
- `filtersCore.ts`, `outboundChannel.ts` si `seenRepository.ts` sunt module tipate, usor de testat separat;
- `src/tsconfig.strict.json` include incremental fisiere stabilizate, nu tot proiectul deodata.

Zonele ramase de imbunatatit sunt reducerea contextului din runtime/registry, inlocuirea ultimelor tipuri `any` unde exista API-uri Discord.js potrivite si mentinerea adapterelor subtiri la marginea sistemului.

## Documentatie suplimentara

- `src/docs/CONTEXT_REPO_CLEAN.md` - stare curenta, structura si zone ramase.
- `src/docs/FUNCTION_MAP_CLEAN.md` - harta pe module si responsabilitati.
- `CHANGELOG.md` - schimbari publice.
- `SECURITY.md` - raportare vulnerabilitati.

## Securitate

- Nu comita token-uri Discord, URI-uri MongoDB reale sau webhook-uri.
- Foloseste `.env.example` ca sablon, nu `.env` real.
- Verifica PR-urile Dependabot si lockfile-ul inainte de merge.
- Ruleaza `npm audit` si testele inainte de release.

## Licenta

MIT. Vezi `LICENSE`.
