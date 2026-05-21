# Context repo curat

## Scopul proiectului

Repo-ul contine un bot Discord pentru notificari automate despre patch notes, update-uri de jocuri, reduceri Steam/Epic, preturi Steam, DLC-uri Steam, status servere si endpoint-uri de health/metrics.

Codul sursa editabil al aplicatiei este in `src`. JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala. Nucleul Rust este in `src/native` si este folosit doar pentru algoritmi puri de fuzzy matching, normalizare, hashing si helperi de text/URL.

## Structura principala

Aplicatia sta sub `src`, iar radacina repo-ului contine documentatie, release notes, politica de securitate, exemple vizuale, CI, licenta si infrastructura de rulare.

```text
README.md
CHANGELOG.md
SECURITY.md
LICENSE
Dockerfile
docker-compose.yml
.dockerignore
.github/
  dependabot.yml
  workflows/
    ci.yml
    codeql.yml
    dependency-audit.yml
    release.yml
docs/
  assets/
    embed-help.svg
    embed-update.svg
    embed-discount.svg
src/
  .env.example
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.strict.json
  app/
  config/
  domain/
  features/
    commands/
      commandRegistry.ts
      interactions.ts
      subscriptionInteractions.ts
      ui.ts
    notifications/
      index.ts
      outboundChannel.ts
  infra/
  native/
  scripts/
  shared/
  sources/
  test/
    commandRegistry.functional.test.ts
    sourceRegistry.functional.test.ts
    subscriptionInteractions.functional.test.ts
    startDiscountsFlow.e2e.test.ts
    startUpdatesFlow.e2e.test.ts
    ...
  docs/
```

`dist/`, `node_modules/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output-uri generate si nu se editeaza manual.

## Rulare si verificare

Instalarea dependintelor se face din `src` cu lockfile-ul comis:

```bash
cd src
npm ci
cp .env.example .env
```

`src/.env.example` documenteaza variabilele pe categorii: runtime, Mongo, Discord, metrics, reverse proxy, admin webhook, proxy URL templates, logging, scraping, Discord throughput, circuit breaker, pending queues, cache-uri, Mongo pool si HTTP rate limit.

Pentru dezvoltare locala:

```bash
npm run dev
```

Pentru productie sau Docker, build-ul si pornirea sunt separate:

```bash
npm run build
npm start
```

`npm start` porneste doar codul deja compilat din `dist/app/main.js`.

Verificari importante:

```bash
npm run check
npm run audit
```

`npm run check` ruleaza `typecheck`, `typecheck:strict`, build Rust + TypeScript, syntax check, config check si testele din `dist/test`. `npm run audit` verifica dependintele runtime.

Din radacina repo-ului poti porni botul si MongoDB cu:

```bash
docker compose up --build
```

Compose tine MongoDB doar in reteaua Docker interna (`expose: 27017`) si publica botul doar pe `127.0.0.1:3000`. Pentru acces local temporar la Mongo din host trebuie folosit un override necomis si legat doar pe loopback.

## README, changelog, security si licenta

README-ul are badge-uri pentru CI, Dependency Audit, CodeQL, Release, Node.js >=20 si licenta MIT. Licenta proiectului este in `LICENSE`.

`CHANGELOG.md` tine istoricul de versiuni si explica tag-urile semver `vMAJOR.MINOR.PATCH`. Pentru un release nou se actualizeaza changelog-ul, se face merge in `main`, apoi se impinge un tag de forma `v1.1.0`.

`SECURITY.md` explica raportarea privata a vulnerabilitatilor prin GitHub Security Advisories, CodeQL, secret scanning, push protection si regula de rotire imediata a tokenurilor/credentialelor expuse.

## Docker, GHCR si release

`Dockerfile` face build multi-stage: compileaza Rust/N-API si TypeScript in stage-ul de build, apoi imaginea runtime instaleaza doar dependintele production si porneste `npm start`.

`.github/workflows/release.yml` publica imaginea Docker in GitHub Container Registry la fiecare tag `v*.*.*` sau release manual:

```text
ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>
ghcr.io/ciobotaruandrei/discord-patch-bot:latest
```

Workflow-ul ruleaza `npm run check` inainte sa publice imaginea si inainte sa creeze GitHub Release. Release-ul devine real si vizibil dupa ce `main` primeste un tag semver, de exemplu `v1.1.0`.

## TypeScript si ctx legacy

Regula curenta: sursa aplicatiei din `src` este TypeScript. Runtime-ul compilat TypeScript este CommonJS, deci importurile prin `require` si `module.exports` sunt acceptate unde ajuta la migrare sigura.

`src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy construite dinamic. Codul nou nu trebuie sa copieze acest model.

Reducerea treptata a `ctx` dinamic:

- `src/features/commands/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)`, deci installer-ele pot fi injectate si testate explicit.
- `src/features/commands/subscriptionInteractions.ts` extrage `/start updates`, `/stop updates`, `/start reduceri` si `/stop reduceri` intr-o factory cu dependinte explicite; installer-ul ei intercepteaza doar comenzile start/stop si deleaga restul catre handlerul existent.
- `src/sources/sourceRegistry.ts` expune `createSourceRegistry(baseContext, installers)`, deci sursele HTTP, Steam, updates si deals pot fi injectate si testate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure tipate direct.
- `src/domain/deals/filters.ts` ramane adapter pentru codul legacy care asteapta atasare pe context.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat, iar `src/features/notifications/index.ts` il foloseste prin dependinte injectate.
- `src/test/subscriptionInteractions.functional.test.ts`, `src/test/startUpdatesFlow.e2e.test.ts` si `src/test/startDiscountsFlow.e2e.test.ts` acopera fluxurile care ating `interactions.ts` si `notifications/index.ts`.

Urmatoarele tinte sanatoase pentru refactor sunt restul din `features/commands/interactions.ts` si persistenta din `features/notifications/index.ts`, mutate treptat spre factory-uri cu dependinte explicite.

## Securitate si mentenanta GitHub

- `.github/workflows/ci.yml` ruleaza pe push, pull request si pornire manuala, foloseste Node.js 20, instaleaza Rust stable, instaleaza dependintele in `src` cu `npm ci` si executa `npm run check`.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript la push, pull request, saptamanal si manual.
- `.github/workflows/dependency-audit.yml` ruleaza saptamanal si manual `npm audit --omit=dev --audit-level=moderate` in `src`.
- `.github/workflows/release.yml` ruleaza la tag-uri `v*.*.*` sau manual cu input `tag`; face checkout pe ref-ul de release, ruleaza `npm run check`, publica imaginea Docker in GHCR si creeaza GitHub Release.
- `.github/dependabot.yml` propune PR-uri saptamanale pentru npm si GitHub Actions, cu grupuri separate pentru dependinte runtime, build/types si actions.
- Secret scanning pentru repo-uri publice este gestionat de GitHub; push protection trebuie activat din setarile repo-ului cand este disponibil.

## Commands si notificari

Comenzile sunt in `src/features/commands`:

- `commandRegistry.ts`: agregatorul comenzilor si contractul functiilor cerute din context.
- `cache.ts`: cache runtime, cooldown-uri si LRU.
- `ui.ts`: embed-uri, paginare, fuzzy matching, status si pret Steam.
- `slashCommands.ts`: definitii si inregistrare slash commands.
- `interactions.ts`: handler-ele slash si autocomplete ramase in stil legacy.
- `subscriptionInteractions.ts`: serviciu/factory pentru start/stop subscription flows.

Notificarile automate sunt in `src/features/notifications`:

- `index.ts`: fluxurile cron pentru update-uri si reduceri, claim atomic, rollback si pending queues.
- `outboundChannel.ts`: resolver tipat pentru fetch canal Discord, permisiuni embed si erori permanente/tranzitorii.

Reguli care nu trebuie rupte: claim atomic pentru `seen`, rollback cand Discord send esueaza, pending queues, activation id pentru `/start`, filtre per joc/store/pret/procent, ping de rol o singura data per ciclu si dezactivare canal pentru erori Discord permanente.

## Teste si scripturi

Scripturile sunt TypeScript:

- `src/scripts/check-config.ts` valideaza config-ul.
- `src/scripts/check-syntax.ts` pica verificarea daca apare orice fisier `.js` in sursa `src`, ignorand output-ul generat din `dist` si loader-ul N-API `native/index.js`.

Teste importante:

- `src/test/subscriptionInteractions.functional.test.ts` verifica factory-ul pentru start/stop si wrapper-ul care deleaga comenzile non-subscription.
- `src/test/startUpdatesFlow.e2e.test.ts` verifica fluxul complet `/start updates -> baseline Mongo -> cron -> embed -> seen`.
- `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxul complet `/start reduceri -> baseline reduceri -> cron -> deal embed -> seenDiscounts`.
- `src/test/commandRegistry.functional.test.ts` verifica registrul de comenzi cu installer-e mock injectate.
- `src/test/sourceRegistry.functional.test.ts` verifica registrul de surse cu installer-e mock injectate.
- `src/test/dealFiltersCore.functional.test.ts` verifica direct filtrele de reduceri si helperii de normalizare.
- `src/test/setGamesInteraction.functional.test.ts` verifica functional `/set games add/remove` si cheia invalida.
- `src/test/mongoMigrations.functional.test.ts` verifica migrarile Mongo cu colectii fake si release de lock.
- `src/test/resolveOutboundChannel.test.ts` verifica direct serviciul de canal Discord pentru erori permanente vs tranzitorii.
- `src/test/httpClientSecurity.test.ts` verifica URL guard-ul si proxy fallback-ul.
- `src/test/commands-regression.test.ts` ramane guard textual pentru regresii importante.
- `src/test/cronController.test.ts`, `src/test/housekeeping.test.ts` si `src/test/rustFuzzy.test.ts` acopera scheduler, housekeeping si helperii nativi.
