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
.github/
docs/assets/
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
    command-cache/
      commandCache.ts
    command-definitions/
      slashCommandDefinitions.ts
    command-handlers/
      gameFilterHandlers.ts
      helpInteractionHandler.ts
      rolePingHandlers.ts
      subscriptionNotificationHandlers.ts
    command-presentation/
      commandPresentation.ts
    command-registry/
      commandRegistry.ts
    command-router/
      legacyInteractionRouter.ts
    command-runtime/
      commandRuntimeContext.ts
    command-security/
      adminCommandRouterGuard.ts
      adminPermissionGuard.ts
    notifications/
      index.ts
      outboundChannel.ts
  infra/
  native/
  scripts/
  shared/
  sources/
  test/
  docs/
```

Zona de comenzi nu mai are fisiere sursa in vechiul folder plat `src/features/commands/`. Rutele ramase in stil legacy (`/latest`, `/dlc`, `/status` si autocomplete) sunt mutate in `src/features/command-router/legacyInteractionRouter.ts`, ca si partea temporara sa stea intr-un folder numit dupa functionalitate.

`dist/`, `node_modules/`, `native/target/`, fisierele `.node`, `native/index.js` si `native/index.d.ts` sunt output-uri generate si nu se editeaza manual.

## Rulare si verificare

Instalarea dependintelor se face din `src` cu lockfile-ul comis:

```bash
cd src
npm ci
cp .env.example .env
```

Pentru dezvoltare locala:

```bash
npm run dev
```

Pentru productie sau Docker, build-ul si pornirea sunt separate:

```bash
npm run build
npm start
```

Verificari importante:

```bash
npm run check
npm run audit
npm run check:dependencies
```

`npm run check` ruleaza `typecheck`, `typecheck:strict`, build Rust + TypeScript, syntax check, config check, dependency policy check si testele din `dist/test`. `npm run audit` verifica dependintele runtime. `npm run check:dependencies` verifica local lockfile-ul si pachetele runtime/build directe pin-uite exact.

Din radacina repo-ului poti porni botul si MongoDB cu:

```bash
docker compose up --build
```

Compose tine MongoDB doar in reteaua Docker interna (`expose: 27017`) si publica botul doar pe `127.0.0.1:3000`. Pentru acces local temporar la Mongo din host trebuie folosit un override necomis si legat doar pe loopback.

## README, changelog, security si licenta

README-ul are badge-uri pentru CI, Dependency Audit, CodeQL, Release, Node.js >=20 si licenta MIT. Licenta proiectului este in `LICENSE`.

`CHANGELOG.md` tine istoricul de versiuni si explica tag-urile semver `vMAJOR.MINOR.PATCH`. Release workflow-ul genereaza `release-notes.md` din sectiunea tag-ului curent, nu foloseste tot changelog-ul ca body.

`SECURITY.md` explica raportarea privata a vulnerabilitatilor prin GitHub Security Advisories, CodeQL, Dependency Review, audit npm, secret scanning, push protection, runtime admin guard si regula de rotire imediata a tokenurilor/credentialelor expuse.

## TypeScript si ctx legacy

Regula curenta: sursa aplicatiei din `src` este TypeScript. Runtime-ul compilat TypeScript este CommonJS, deci importurile prin `require` si `module.exports` sunt acceptate unde ajuta la migrare sigura.

`src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy construite dinamic. Codul nou nu trebuie sa copieze acest model.

Reducerea treptata a `ctx` dinamic:

- `src/features/command-registry/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)`, deci installer-ele pot fi injectate si testate explicit.
- `src/features/command-definitions/slashCommandDefinitions.ts` este inclus in `tsconfig.strict.json` si foloseste tipuri locale pentru builder-ele Discord, in loc de callback-uri `any`.
- `src/features/command-security/adminCommandRouterGuard.ts` impune runtime administrator check pentru `/start`, `/stop` si `/set`, apoi deleaga la handler-ul concret doar daca utilizatorul este admin.
- `src/features/command-handlers/helpInteractionHandler.ts` extrage `/help` intr-o factory cu dependinte explicite; installer-ul ei intercepteaza doar `/help` si deleaga restul.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts` extrage `/start updates`, `/stop updates`, `/start reduceri` si `/stop reduceri` intr-o factory cu dependinte explicite.
- `src/features/command-handlers/gameFilterHandlers.ts` extrage `/set games add/remove/list/reset` intr-o factory cu dependinte explicite.
- `src/features/command-handlers/rolePingHandlers.ts` extrage `/set role updates/discounts` intr-o factory cu dependinte explicite.
- `src/features/command-router/legacyInteractionRouter.ts` tine rutele legacy ramase intr-un modul localizat dupa functionalitate, pana cand si acestea sunt extrase.
- `src/sources/sourceRegistry.ts` expune `createSourceRegistry(baseContext, installers)`, deci sursele HTTP, Steam, updates si deals pot fi injectate si testate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure tipate direct.
- `src/domain/deals/filters.ts` ramane adapter pentru codul legacy care asteapta atasare pe context.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat, iar `src/features/notifications/index.ts` il foloseste prin dependinte injectate.

Urmatoarele tinte sanatoase pentru refactor sunt rutele ramase din `features/command-router/legacyInteractionRouter.ts` (`latest`, `dlc`, `status`, autocomplete) si persistenta din `features/notifications/index.ts`, mutate treptat spre factory-uri cu dependinte explicite.

## Dependinte npm si supply chain

- Runtime dependencies si build/dev dependencies directe din `src/package.json` sunt versiuni exacte.
- `src/package-lock.json` ramane sursa de instalare reproductibila prin `npm ci`.
- `src/scripts/check-dependencies.ts` pica daca o dependinta runtime/dev directa nu este pin-uita exact, daca intrarea directa din lockfile nu rezolva la versiunea asteptata sau daca o intrare de lockfile vine din alta sursa decat `https://registry.npmjs.org`.
- `.github/workflows/dependency-review.yml` verifica daca GitHub Dependency graph este activ; cand este activ, Dependency Review ruleaza blocant pentru vulnerabilitati moderate sau mai grave.
- `.github/workflows/dependency-audit.yml` ruleaza audit runtime saptamanal si manual.
- PR-urile Dependabot trebuie citite: diff lockfile, rezultat Dependency Review, audit, CI complet si release notes ale pachetului.

## Docker, GHCR si release

`Dockerfile` face build multi-stage: compileaza Rust/N-API si TypeScript in stage-ul de build, apoi imaginea runtime instaleaza doar dependintele production, copiaza output-ul, face ownership pe `/app` si ruleaza `npm start` ca user non-root `node`.

`.github/workflows/release.yml` publica imaginea Docker in GitHub Container Registry la fiecare tag `v*.*.*` sau release manual:

```text
ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>
ghcr.io/ciobotaruandrei/discord-patch-bot:latest
```

Workflow-ul ruleaza `npm run check`, genereaza `release-notes.md` din sectiunea tag-ului curent din `CHANGELOG.md`, publica imaginea si creeaza GitHub Release. Release-ul devine real si vizibil dupa ce `main` primeste un tag semver, de exemplu `v1.0.0`.

## Commands si notificari

Comenzile sunt organizate pe functionalitate:

- `src/features/command-registry/commandRegistry.ts`: agregatorul comenzilor si contractul functiilor cerute din context.
- `src/features/command-cache/commandCache.ts`: cache runtime, cooldown-uri si LRU.
- `src/features/command-presentation/commandPresentation.ts`: embed-uri, paginare, fuzzy matching, status si pret Steam.
- `src/features/command-definitions/slashCommandDefinitions.ts`: definitii si inregistrare slash commands, inclus in strict TypeScript.
- `src/features/command-security/adminPermissionGuard.ts`: helper runtime pentru verificarea permisiunii Administrator.
- `src/features/command-security/adminCommandRouterGuard.ts`: wrapper exterior pentru `/start`, `/stop` si `/set`.
- `src/features/command-handlers/helpInteractionHandler.ts`: handler extras pentru `/help`.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts`: serviciu/factory pentru start/stop subscription flows.
- `src/features/command-handlers/gameFilterHandlers.ts`: serviciu/factory pentru `/set games`.
- `src/features/command-handlers/rolePingHandlers.ts`: serviciu/factory pentru `/set role`.
- `src/features/command-router/legacyInteractionRouter.ts`: routerul ramas pentru `/latest`, `/dlc`, `/status` si autocomplete, pana cand fiecare ruta este extrasa.

Notificarile automate sunt in `src/features/notifications`:

- `index.ts`: fluxurile cron pentru update-uri si reduceri, claim atomic, rollback si pending queues.
- `outboundChannel.ts`: resolver tipat pentru fetch canal Discord, permisiuni embed si erori permanente/tranzitorii.

Reguli care nu trebuie rupte: claim atomic pentru `seen`, rollback cand Discord send esueaza, pending queues, activation id pentru `/start`, filtre per joc/store/pret/procent, ping de rol o singura data per ciclu si dezactivare canal pentru erori Discord permanente.

## Teste si scripturi

- `src/scripts/check-config.ts` valideaza config-ul.
- `src/scripts/check-dependencies.ts` valideaza politica minima de dependency supply chain.
- `src/scripts/check-syntax.ts` pica verificarea daca apare orice fisier `.js` in sursa `src`, ignorand output-ul generat din `dist` si loader-ul N-API `native/index.js`.
- `src/scripts/extract-release-notes.ts` extrage notele pentru tag-ul curent din `CHANGELOG.md`.
- `src/test/adminGuard.test.ts` verifica runtime admin guard si delegarea pentru comenzile protejate.
- `src/test/helpHandler.functional.test.ts` verifica factory-ul pentru `/help` si wrapper-ul care deleaga comenzile non-help.
- `src/test/rolePingInteractions.functional.test.ts` verifica factory-ul pentru `/set role` si wrapper-ul care deleaga comenzile non-role.
- `src/test/gameFilterInteractions.functional.test.ts` verifica factory-ul pentru `/set games` si wrapper-ul care deleaga comenzile non-game-filter.
- `src/test/subscriptionInteractions.functional.test.ts` verifica factory-ul pentru start/stop si wrapper-ul care deleaga comenzile non-subscription.
- `src/test/startUpdatesFlow.e2e.test.ts` si `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxurile complete cu cron.
- Restul testelor functionale si de regresie acopera HTTP safety, outbound channel, Mongo migrations, filters, source registry, command registry, housekeeping, scheduler si Rust helperi.

## Limite de verificare live

Testele automate folosesc mock-uri si medii controlate. Comportamentul live complet trebuie verificat separat pe server Discord de staging, cu `DISCORD_TOKEN`, Mongo si surse externe reale, fara sa se publice secrete in repo, logs sau screenshots.
