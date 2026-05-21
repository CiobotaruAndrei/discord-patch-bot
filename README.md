# Discord Patch Bot

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

Porneste MongoDB local sau foloseste Docker Compose din radacina repo-ului.

## Comenzi utile

Din `src/`:

```bash
npm run build       # compileaza Rust/N-API si TypeScript
npm start           # porneste codul deja compilat din dist/app/main.js
npm run dev         # build + start pentru dezvoltare locala
npm run check       # typecheck, build, syntax/config check si teste
npm run test        # build + testele Node
npm run lint        # typecheck normal + strict
```

`npm start` nu mai ruleaza build automat. In productie, build-ul trebuie facut in CI sau in imaginea Docker, iar runtime-ul doar porneste `dist/app/main.js`.

## Docker Compose

Din radacina repo-ului:

```bash
cp src/.env.example src/.env
# editeaza DISCORD_TOKEN si DISCORD_CLIENT_ID

docker compose up --build
```

Compose porneste un MongoDB local si botul. Pentru productie seteaza un `METRICS_TOKEN` real si evita expunerea publica a `/metrics`.

## Config jocuri

Lista de jocuri si surse este in `src/config.json`. Fiecare intrare are o cheie (`key`) folosita in comenzi Discord si un tip de sursa, de exemplu `steam`, `epic_games`, `listing_based`, `nvidia`, `amd` sau `intel`.

## Comenzi Discord

Comenzile sunt inregistrate ca slash commands. Suprafata principala include:

- `/start updates` si `/stop updates` pentru update-uri automate
- `/start reduceri` si `/stop reduceri` pentru reduceri automate
- `/latest updates`, `/latest update`, `/latest reduceri` si `/latest pret`
- `/set games`, `/set stores`, `/set role`, `/set mode`, `/set currency`, `/set mindiscount`, `/set maxprice`
- `/games`, `/help`, `/ping`

## Health si metrics

Serverul HTTP expune:

- `/health` si `/healthz` pentru health checks
- `/metrics` pentru Prometheus-style metrics

In productie `/metrics` trebuie protejat cu `METRICS_TOKEN`, exceptand cazul in care setezi explicit `METRICS_PUBLIC=true`.

## Structura

```text
.github/workflows/ci.yml   # GitHub Actions
Dockerfile                 # build multi-stage pentru bot
docker-compose.yml         # bot + MongoDB local
src/
  app/                     # main, lifecycle, scheduler, health
  config/                  # validare config
  domain/                  # reguli domeniu
  features/commands/       # slash commands si interactions
  features/notifications/  # notificari automate
  infra/http/              # HTTP client, proxy, URL safety
  infra/mongo/             # modele, lock-uri, migrari, state
  native/                  # Rust/N-API + fallback TypeScript
  sources/                 # Steam/Epic/RSS/listing scrapers
  test/                    # teste functionale si regresii
```

## Testare

`npm run check` este verificarea completa folosita si in CI. Pe langa regresii textuale, repo-ul are teste functionale cu mock-uri pentru zone critice:

- Discord channel resolution si erori permanente in `resolveOutboundChannel.test.ts`
- HTTP URL safety si proxy fallback in `httpClientSecurity.test.ts`
- Mongo migrations si lock release in `mongoMigrations.functional.test.ts`
- Command registry wiring in `commandRegistry.functional.test.ts`

## Note arhitecturale

Codul legacy foloseste inca module CommonJS care ataseaza functii pe un context comun. Pentru a reduce riscul, migrarea se face treptat: `commandRegistry` expune acum o fabrica testabila cu installer-e injectate explicit, iar urmatorii pasi pot muta modulele Discord/notifications catre servicii/factory-uri mai tipate.
