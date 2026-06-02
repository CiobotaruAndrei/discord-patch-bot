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
- Are fallback-uri, validare DNS/IP pentru request-uri externe si circuit breaker pentru surse fragile.
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
- `/set outbox-recovery-verify <on|off>` - (admin) comuta recovery-verify per-server; la `on` avertizeaza daca botului ii lipseste permisiunea Read Message History pe canalele de notificari.
- `/outbox status | deadletters | retry | pause | resume | permissions | recovery-verify status` - (admin) operarea outbox-ului: coada (per-server + global), dead-letter, reprogramare livrari, pauza/reluare drenare (global), audit de permisiuni pe canale si starea recovery-verify.

Comenzile administrative sunt validate atat prin permisiunile slash command declarate in Discord, cat si prin verificari runtime in handler-ele sensibile.

## Cerinte

- Node.js 20.x
- npm 10+
- MongoDB 7+ sau Docker Compose
- Token Discord si aplicatie Discord configurata cu slash commands

## Setup rapid

```bash
cd src
npm ci
cp .env.example .env
npm run build
npm start
```

Pentru development local cu MongoDB inclus:

```bash
docker compose up --build
```

MongoDB ruleaza doar in reteaua interna Docker; botul se conecteaza prin `MONGO_URI`.

## Variabile de mediu

Fisierul `src/.env.example` documenteaza variabilele importante. Cele minime pentru rulare sunt:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
MONGO_URI=mongodb://mongo:27017/discord-patch-bot
```

Variabile utile suplimentare:

- `DISCORD_DEV_GUILD_ID` - optional, pentru comenzi guild-scoped in development.
- `PORT` - portul serverului local de health/metrics.
- `METRICS_TOKEN` - token optional pentru acces la `/metrics`.
- `METRICS_PUBLIC` - permite metrics fara token in development.
- `LOG_LEVEL` - nivelul de logging.
- `PROXY_URLS` - proxy-uri HTTP optionale pentru surse externe.
- `ADMIN_WEBHOOK_URL` - webhook optional pentru alerte operationale.
- `NOTIFICATION_OUTBOX_ENABLED` - feature flag optional (implicit `false`). Cand este `true`, cron-ul nu mai trimite notificarile inline, ci le pune ca job-uri in colectia `notificationOutbox`, iar un worker dedicat le draneaza pe propriul interval (rate limit + retry/backoff + dead-letter). Recomandat pe volum mare de notificari sau cand vrei ca trimiterea sa supravietuiasca caderilor Discord; lasa-l oprit pentru deploy-uri mici.
- `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS` - cat de des draneaza worker-ul outbox-ul, independent de ciclul cron (implicit `15000`; min `2000`, max `600000`). Activ doar cand `NOTIFICATION_OUTBOX_ENABLED=true`.
- `NOTIFICATION_OUTBOX_DRAIN_LIMIT` - cate job-uri se draneaza intr-un ciclu (implicit `50`; min `1`, max `1000`). TTL-ul lock-ului de drenare se dimensioneaza automat din aceasta valoare si bugetul de trimitere Discord, deci marirea limitei pastreaza lock-ul valid pe toata durata drenarii.
- `NOTIFICATION_OUTBOX_LOCK_TTL_MS` - override optional pentru TTL-ul lock-ului `outbox_drain` (implicit auto-dimensionat; min `120000`, max `3600000`).
- `NOTIFICATION_OUTBOX_SENT_TTL_HOURS` - cat timp se pastreaza istoricul de livrari (`notificationOutboxSent`) folosit pentru a evita re-trimiterea unui job recuperat dupa un crash (implicit `24`; min `1`, max `168`).
- `NOTIFICATION_OUTBOX_RECOVERY_VERIFY` - protectie suplimentara optionala (implicit `false`) pentru fereastra rara `send -> markSent`: cand e `true`, fiecare embed primeste un marker `dedupeKey` in footer, iar un job re-revendicat (`deliveries>1`) verifica intai ultimele mesaje din canal pentru acel marker inainte de a re-trimite. Costa un footer vizibil + un fetch de mesaje Discord la fiecare recovery; lasa-l oprit daca nu ai nevoie. Poate fi suprascris per-guild prin comanda admin `/set outbox-recovery-verify <on|off>` (scrie `outboxRecoveryVerify` in setarile guild-ului). Metrici dedicate la `/metrics`: `bot_outbox_recovery_duplicates_prevented`, `bot_outbox_recovery_history_fetches`, `bot_outbox_recovery_verify_failures`, `bot_outbox_recovery_marker_missing` (fetch reusit dar marker negasit -> re-trimis).
- `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` - cate mesaje recente din canal scaneaza verificarea de recovery pentru marker (implicit `25`; min `5`, max `100`).
- `NOTIFICATION_OUTBOX_RECOVERY_STRICT` - mod strict optional (implicit `false`) pentru recovery-verify: cand fetch-ul de istoric esueaza (nu poate citi mesajele), in loc sa trimita oricum (fail-open), nu trimite, reprogrameaza jobul cu backoff si numara `recoveryFailures` + trimite admin alert (fail-closed). Util pe servere unde duplicatele sunt foarte grave.
- Sanatatea outbox-ului este expusa la `/metrics`: `bot_outbox_sent`, `bot_outbox_retried`, `bot_outbox_dead_lettered`, `bot_outbox_drains`, `bot_outbox_queue_depth`, `bot_outbox_delivery_ms_total` (latenta cumulata; impreuna cu `bot_outbox_sent` da latenta medie), `bot_outbox_oldest_job_age_seconds` (vechimea celui mai vechi job in coada), `bot_outbox_lock_acquire_failures`, `bot_outbox_mark_sent_failures` (livrari care nu au putut fi marcate in istoricul de dedupe -> risc de re-trimitere la recovery) si `bot_outbox_recovery_verify_enabled_guilds` (gauge: cate servere au recovery-verify activ per-guild). Coada `notificationOutbox` are si un index unic *sparse* pe `dedupeKey`, deci doua joburi pending cu acelasi continut nu pot coexista. Cand un drain raporteaza esecuri de citire a istoricului (recovery-verify) sau de marcare, worker-ul trimite si un admin alert (cu cooldown) ca operatorul sa afle proactiv.

## Structura proiectului

```text
src/
  app/
    main.ts                 # entry subtire: cablare deps + apel boot
    appRuntime.ts           # createAppRuntime(deps) -> { start, stop, schedulers }
    scheduler/              # cron, outbox worker, housekeeping
    lifecycle/              # inregistrare event-uri Discord/Mongo si shutdown
    health/httpServer.ts    # /healthz si /metrics
  config/                   # loader si validator pentru config.json
  domain/deals/             # filtre pure pentru deal-uri si pending queues
  features/
    command-cache/          # cache-uri in-memory pentru comenzi
    command-registry/       # instalare module de comenzi
    command-runtime/        # context runtime pentru comenzi
    command-definitions/    # definitii slash commands
    command-presentation/   # embed-uri, paginare si UI Discord
    command-security/       # guard-uri admin runtime
    command-handlers/       # handler-e tipate pentru comenzi si autocomplete
    notifications/          # wiring notificari, seen repo, servicii update/reduceri
  infra/
    http/                   # client HTTP, proxy, retry, limitari, DNS/IP guard
    mongo/                  # conexiune, modele, locks, migratii
  shared/                   # tipuri/utilitare comune
  sources/                  # surse Steam/Epic/listing/RSS si registry
  docs/                     # harti de context si functie
  native/                   # optional Rust/N-API pentru operatii hot-path
.github/workflows/          # CI, audit, dependency review, release
```

Nu mai exista un `command-router` activ ca structura curenta. Handler-ele cunoscute sunt in `src/features/command-handlers/`, iar `fallbackInteractionHandler.ts` ramane doar ca fallback de final pentru interactiuni necunoscute sau neacoperite explicit.

## Testare

```bash
cd src
npm test
npm run test:functional
npm run test:e2e
npm run typecheck
npm run typecheck:strict
npm run check
npm run check:comments
npm run build
npm audit
```

`npm run check` ruleaza si `check:comments` (`scripts/check-no-comments.ts`), care esueaza daca exista comentarii (`//` sau `/* */`) in fisierele sursa `.ts`/`.js`/`.rs`, conform regulii „fara comentarii in cod". Allowlist-ul de exceptii este gol (zero exceptii); rationale-ul subtil de concurenta din `cron.ts` a fost mutat in `src/docs/CONTEXT_REPO_CLEAN.md`.

Testele acopera zonele importante:

- validare env si configuratie;
- registrul de comenzi si guard-uri anti-regresie;
- handler-e functionale pentru `/help`, `/ping`, `/games`, `/set`, `/outbox`, `/latest`, `/dlc`, `/status` si autocomplete;
- servicii de notificari pentru update-uri si reduceri;
- repository-ul `seen` pentru deduplicare;
- fluxuri E2E pentru update-uri si reduceri;
- parsere, filtre, shape drift pe scrapers, circuit breaker, cooldown-uri si rate limiting;
- integrare pe MongoDB real (`outboxMongoIndex.integration.test.ts`): verifica indexul unic sparse pe `notificationOutbox.dedupeKey`; ruleaza in CI (serviciu `mongo:7`) si local cand `MONGO_URI` indica un Mongo pornit, altfel se auto-sare.
- crash-simulation outbox (`outboxCrashRecovery.functional.test.ts`): send reuseste dar `markSent` nu apuca (crash), iar la repornire recovery-verify previne duplicatul (cu test-contrast care arata duplicatul fara recovery-verify).

In CI (`ci.yml`), pe langa `npm run check`, se ruleaza si validarea Rust: `cargo clippy --all-targets -- -D warnings` si `cargo test` (teste unitare native in `native/src/lib.rs`). Compilarea Rust se face deja prin `napi build` din `npm run build`.

Testele care folosesc surse externe reale nu confirma comportament live cu token Discord real. Pentru productie, valideaza si cu un server Discord de test si MongoDB real.

## Build, start si release

Build-ul si start-ul sunt separate:

```bash
cd src
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
- `commandCache.ts`, `commandPresentation.ts`, `mongoContext.ts`, `notifications/index.ts` si fallback-ul de interactiuni expun factory-uri explicite; atasarea pe target comun ramane doar strat de compatibilitate;
- `domain/deals/filtersCore.ts`, `outboundChannel.ts` si `seenRepository.ts` sunt module tipate, usor de testat separat;
- `src/native/` contine Rust/N-API pentru hot-path-uri pure: fuzzy matching, autocomplete scoring, hash-uri, normalizare text/scoring si filtrarea ofertelor;
- `src/tsconfig.strict.json` include incremental fisiere stabilizate, inclusiv modulele de surse Steam/deals/updates si testele directe pe shape drift;
- `legacy-dynamic.d.ts` a fost eliminat; tipurile trebuie rezolvate local, nu prin extinderea globala a `Object`.
- codul runtime din `app`, `domain`, `features`, `infra`, `shared` si `sources` nu mai foloseste tipuri wildcard nesigure sau abrevierea legacy de context; adapterele ramase folosesc `target`/`deps` tipate structural.
- fisierele de cod sunt tinute fara comentarii explicative; contextul de arhitectura, operare si mentenanta sta in README, changelog si `src/docs/`.

Zonele ramase de imbunatatit sunt reducerea target-ului comun din runtime/registry, tiparea mai stricta a mock-urilor din teste si mentinerea adapterelor subtiri la marginea sistemului.

## Documentatie suplimentara

- `src/docs/CONTEXT_REPO_CLEAN.md` - stare curenta, structura si zone ramase.
- `src/docs/FUNCTION_MAP_CLEAN.md` - harta pe module si responsabilitati.
- `CHANGELOG.md` - schimbari publice.
- `OPERATIONS.md` - runbook de operare (outbox: metrici, alerte, pauza, recovery-verify, setari recomandate).
- `monitoring/` - reguli de alertare Prometheus (`prometheus-alerts.yml`) si dashboard Grafana (`grafana-dashboard.json`) versionate, cu instructiuni in `monitoring/README.md`.
- `SECURITY.md` - raportare vulnerabilitati.

## Securitate

- Nu comita token-uri Discord, URI-uri MongoDB reale sau webhook-uri.
- Foloseste `src/.env.example` ca sablon, nu `src/.env` real.
- Verifica PR-urile Dependabot si lockfile-ul inainte de merge.
- Ruleaza `npm audit` si testele inainte de release.

## Licenta

MIT. Vezi `LICENSE`.
