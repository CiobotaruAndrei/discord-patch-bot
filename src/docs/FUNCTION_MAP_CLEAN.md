# Function map curat

Acest fisier documenteaza responsabilitatile modulelor importante din repo. Sursa din `src` este TypeScript, cu un nucleu Rust in `src/native` pentru algoritmi puri. Fisierele `.js` apar dupa build in `dist/` sau ca loader N-API generat.

## Conventii generale

- Proiectul compileaza Rust nativ si apoi TypeScript catre `src/dist/`.
- Runtime-ul compilat TypeScript este CommonJS.
- `src/package-lock.json` blocheaza versiunile de dependinte, iar CI instaleaza cu `npm ci`.
- `src/package.json` pin-uieste exact dependintele directe runtime si build/dev.
- `src/tsconfig.json` are `allowJs: false`, `strict: true` si `noImplicitAny: true`.
- `src/tsconfig.strict.json` include zone stabilizate explicit din health, scheduler, source registry, deal filters, command registry, command handlers, command security, release/dependency scripts, HTTP client si testele directe.
- `src/scripts/check-syntax.ts` pica verificarea daca mai apare un fisier `.js` in sursa `src`, ignorand `dist/` si loader-ul generat `native/index.js`.
- `src/scripts/check-dependencies.ts` pica verificarea daca runtime/build deps directe nu sunt exacte, daca intrarile directe din lockfile nu rezolva la versiunile asteptate sau daca pachetele din lockfile nu vin din registry npm peste HTTPS.
- Agregatoarele descriptive sunt `src/infra/mongo/mongoContext.ts`, `src/sources/sourceRegistry.ts` si `src/features/command-registry/commandRegistry.ts`.
- `src/types.ts` tine tipurile comune folosite intre module.
- `src/legacy-dynamic.d.ts` este un shim temporar pentru obiecte legacy dinamice.
- `src/native` contine cod Rust doar pentru algoritmi puri, nu pentru Discord/Mongo/HTTP.

## Radacina repo-ului

### `README.md`

Rol: ghid principal pentru setup, env, comenzi, Docker non-root, audit, Dependency Review, CodeQL, GHCR release image, security, health/metrics, structura, testare, badge-uri si exemple vizuale de embed-uri.

### `CHANGELOG.md`

Rol: istoric de versiuni si schimbari notabile. Explica folosirea tag-urilor semver `vMAJOR.MINOR.PATCH`, mentioneaza CodeQL, Dependency Review, dependency policy check, refactorizarile command handlers, runtime admin guard, imaginea GHCR si release notes pe sectiunea tag-ului curent.

### `SECURITY.md`

Rol: politica de raportare privata a vulnerabilitatilor si reguli pentru secret/dependency management. Acopera tokenuri Discord, credentiale Mongo, `METRICS_TOKEN`, webhook-uri, proxy URL-uri, CodeQL, Dependency Review, audit npm, secret scanning, push protection, runtime admin guard si build-tool supply chain.

### `.github/workflows/ci.yml`

Rol: workflow-ul real de CI.

Comportament: ruleaza pe push, pull request si `workflow_dispatch`, foloseste Node.js 20, instaleaza Rust stable, lucreaza in `src`, instaleaza dependintele cu `npm ci` si executa `npm run check`.

### `.github/workflows/codeql.yml`

Rol: analiza CodeQL pentru JavaScript/TypeScript.

Comportament: ruleaza pe push in `main`, pull request spre `main`, saptamanal si manual. Foloseste `github/codeql-action/init@v4` cu `languages: javascript-typescript`, `build-mode: none` si query suite `security-extended,security-and-quality`, apoi `github/codeql-action/analyze@v4`.

### `.github/workflows/dependency-audit.yml`

Rol: audit periodic si manual pentru dependinte runtime.

Comportament: ruleaza saptamanal si la `workflow_dispatch`, lucreaza in `src`, instaleaza cu `npm ci` si executa `npm audit --omit=dev --audit-level=moderate`.

### `.github/workflows/dependency-review.yml`

Rol: review pe PR-uri pentru schimbari de dependinte sau workflow-uri.

Comportament: ruleaza la pull request spre `main` cand se modifica `src/package.json`, `src/package-lock.json`, `.github/dependabot.yml` sau `.github/workflows/**`. Verifica intai statusul GitHub Dependency graph prin `actions/github-script@v7`. Cand Dependency graph este activ, ruleaza `actions/dependency-review-action@v4` fara `continue-on-error` si pica pe vulnerabilitati moderate sau mai grave.

### `.github/workflows/release.yml`

Rol: release automat pentru tag-uri semver si imagine Docker publicata.

Comportament: ruleaza la tag-uri `v*.*.*` sau manual cu input `tag`, rezolva tag-ul si numele imaginii lowercase, face checkout pe ref-ul de release, instaleaza Node.js 20 si Rust stable, ruleaza `npm ci` si `npm run check` in `src`, ruleaza `src/scripts/extract-release-notes.ts` din output-ul compilat ca sa scrie `release-notes.md`, construieste `Dockerfile`, publica imaginea in GHCR si creeaza GitHub Release cu notele tag-ului curent plus release notes generate de GitHub.

Output GHCR:

```text
ghcr.io/ciobotaruandrei/discord-patch-bot:<tag>
ghcr.io/ciobotaruandrei/discord-patch-bot:latest
```

### `Dockerfile`

Rol: imagine multi-stage pentru productie.

Comportament: stage-ul de build instaleaza toolchain-ul necesar si ruleaza build Rust + TypeScript. Stage-ul runtime instaleaza doar dependinte production, copiaza output-ul compilat, face `chown -R node:node /app`, trece pe `USER node` si porneste `npm start`.

## Build si scripts

### `src/package.json`

Scripturi importante:

- `build:rust`: compileaza addon-ul Rust prin `napi build --platform --release`.
- `build:ts`: compileaza TypeScript cu `tsc`.
- `build`: ruleaza Rust apoi TypeScript.
- `start`: porneste doar `dist/app/main.js`; nu mai ruleaza build la runtime.
- `dev`: build + start pentru dezvoltare locala.
- `typecheck`: ruleaza `tsc --noEmit` cu `strict` activ in configuratia principala.
- `typecheck:strict`: ruleaza `tsc -p tsconfig.strict.json` pe lista explicita de fisiere stabilizate.
- `test`: build + testele Node.
- `audit`: ruleaza `npm audit --omit=dev --audit-level=moderate`.
- `check:dependencies`: build TypeScript minimal si ruleaza `dist/scripts/check-dependencies.js`.
- `check`: ruleaza typecheck normal, typecheck strict separat, build, syntax check, config check, dependency check si testele.

### `src/scripts/check-dependencies.ts`

Rol: guard local si CI pentru supply chain npm. Verifica runtime si build/dev dependencies directe pin-uite exact, intrarile directe din lockfile, lockfileVersion modern si URL-uri `https://registry.npmjs.org`.

### `src/scripts/extract-release-notes.ts`

Rol: extrage doar sectiunea tag-ului curent din `CHANGELOG.md` pentru GitHub Release. Daca tag-ul nu are sectiune dedicata, scrie un body scurt de fallback in loc sa publice tot changelog-ul.

### `src/tsconfig.strict.json`

Verificare stricta separata pentru zone stabilizate explicit: health server, scheduler, `domain/deals/filtersCore.ts`, command registry, slash definitions, command cache, command presentation, command security, help/subscription/game-filter/role-ping handlers, outbound channel, source registry, dependency/release scripts, HTTP client, erori shared si testele directe pentru acele zone.

## App si infrastructura

### `src/app/main.ts`

Entrypoint-ul botului. Incarca config-ul, creeaza metrici, client Discord, rate limiter, housekeeping, cron controller, HTTP server si shutdown controller; apoi conecteaza MongoDB, ruleaza migrarile, porneste HTTP si face login la Discord. Incarca comenzile din `src/features/command-registry/commandRegistry.ts`.

### `src/app/health/httpServer.ts`

Expune `/health`, `/healthz`, `/metrics`, aplica rate limit, protejeaza metrics cu token cand e necesar si previne duplicarea accidentala a metricilor Prometheus cu acelasi nume.

### `src/app/scheduler/cron.ts`

Coordoneaza ciclurile cron cu lock distribuit, health window, backoff global, abort signal si curatarea handle-ului programat la `stop()`.

### `src/infra/http/client.ts`

Client HTTP comun cu retry/backoff, user-agent random, proxy fallback, limite de bytes, in-flight coalescing si validare URL. Normalizarile pure si hash-urile sunt delegate catre `src/native/fuzzy.ts`.

### `src/infra/mongo/*`

Modele Mongo, lock-uri distribuite, migrari, state global, cache guild settings si alerte admin.

## Sources si domain

### `src/sources/sourceRegistry.ts`

Agregator pentru client HTTP, Steam helpers, update sources si deals sources. Expune `createSourceRegistry(baseContext, installers)` pentru wiring explicit si testabil, apoi pastreaza exporturile vechi pentru compatibilitate cu runtime-ul curent.

### `src/domain/deals/filtersCore.ts`

Core tipat pentru regulile de reduceri. Exporta direct `dealPassesFilters`, `normalizePendingUpdateArray`, `normalizePendingDiscountArray`, `toEntries`, `mapToObject`, `getSeenSet` si `rotateAfter`.

### `src/domain/deals/filters.ts`

Adapter legacy pentru context. Importa functiile din `filtersCore.ts`, le expune ca proprietati pe export si le ataseaza pe `ctx` pentru modulele vechi.

## Commands

Comenzile au fost mutate dintr-un folder plat `src/features/commands/` in foldere numite dupa functionalitate. Nu mai exista sursa manuala in vechiul folder `commands`; inclusiv routerul ramas pentru rutele inca neextrase a fost mutat in `src/features/command-router/legacyInteractionRouter.ts`.

### `src/features/command-registry/commandRegistry.ts`

Agregator pentru wiring-ul comenzilor. Instaleaza cache, filtre, prezentare UI, notificari, definitii slash command, handler-e dedicate, guard-ul admin si routerul legacy. Registrul declara functiile asteptate din context si foloseste `requireRegistryFunction` ca sa pice devreme daca un modul nu a atasat o dependinta obligatorie.

### `src/features/command-runtime/commandRuntimeContext.ts`

Construieste contextul runtime pentru comenzi din modelele Mongo, logger, helpers Discord, cache, metrici si functii shared.

### `src/features/command-cache/commandCache.ts`

Responsabil pentru cache-ul folosit de comenzi si pentru refresh-ul controlat al datelor expuse in interactiuni.

### `src/features/command-presentation/commandPresentation.ts`

Grupeaza helperii de UI pentru embed-uri, paginare, select menus si raspunsuri folosite de comenzi.

### `src/features/command-definitions/slashCommandDefinitions.ts`

Defineste si inregistreaza slash commands. Este in strict TypeScript si foloseste tipuri locale pentru builder-ele Discord, ca zona de definire a comenzilor sa nu mai depinda de callback-uri `any`.

### `src/features/command-security/adminPermissionGuard.ts`

Helper runtime care verifica `memberPermissions` pentru `PermissionsBitField.Flags.Administrator` si raspunde ephemeral cand utilizatorul nu are drepturi de admin.

### `src/features/command-security/adminCommandRouterGuard.ts`

Wrapper exterior pentru `/start`, `/stop` si `/set`. Daca utilizatorul nu este admin, opreste comanda inainte de `safeDefer` si inainte de orice update Mongo. Daca este admin, deleaga la handler-ele dedicate sau la fallback-ul legacy.

### `src/features/command-handlers/helpInteractionHandler.ts`

Handler TypeScript pentru `/help`. Expune `createHelpHandler(deps)` pentru teste si instaleaza un wrapper care intercepteaza doar `/help`.

### `src/features/command-handlers/subscriptionNotificationHandlers.ts`

Serviciu TypeScript pentru `/start updates`, `/stop updates`, `/start reduceri` si `/stop reduceri`. Expune `createSubscriptionInteractionHandlers(deps)` pentru teste cu dependinte explicite si un installer CommonJS care intercepteaza doar comenzile start/stop.

### `src/features/command-handlers/gameFilterHandlers.ts`

Serviciu TypeScript pentru `/set games add/remove/list/reset`. Expune `createGameFilterInteractionHandlers(deps)` pentru teste cu dependinte explicite si un installer CommonJS care intercepteaza doar grupul `/set games`.

### `src/features/command-handlers/rolePingHandlers.ts`

Serviciu TypeScript pentru `/set role updates/discounts`. Expune `createRolePingInteractionHandlers(deps)` pentru teste cu dependinte explicite si un installer CommonJS care intercepteaza doar grupul `/set role`.

### `src/features/command-router/legacyInteractionRouter.ts`

Router temporar pentru slash commands si autocomplete ramase in stil legacy: `/latest`, `/dlc`, `/status` si autocomplete. Dispatch-ul runtime pentru `/help`, `/start`, `/stop`, `/set games`, `/set role` si admin guard-ul pentru `/set` sunt suprascrise de servicii dedicate instalate dupa acest modul.

## Notifications

### `src/features/notifications/outboundChannel.ts`

Serviciu TypeScript tipat pentru rezolvarea canalului Discord outbound: fetch canal, distinctie erori permanente/tranzitorii, verificare permisiuni embed si dezactivare sigura a canalului cand e cazul.

### `src/features/notifications/index.ts`

Update-uri si reduceri automate: claim atomic, rollback, pending queues, activation guards, filtre si trimitere embed-uri. Foloseste `createOutboundChannelResolver` din `outboundChannel.ts`, dar inca expune functiile pe `ctx` ca adapter legacy.

## Teste importante

- `src/test/adminGuard.test.ts`: helper runtime admin si wrapper de blocare/delegare pentru comenzile protejate.
- `src/test/helpHandler.functional.test.ts`: factory si wrapper pentru `/help`.
- `src/test/extractReleaseNotes.test.ts`: extragere release notes din `CHANGELOG.md`.
- `src/test/rolePingInteractions.functional.test.ts`: factory si wrapper pentru `/set role`.
- `src/test/gameFilterInteractions.functional.test.ts`: factory si wrapper pentru `/set games`.
- `src/test/subscriptionInteractions.functional.test.ts`: factory si wrapper pentru `/start` si `/stop`.
- `src/test/startUpdatesFlow.e2e.test.ts`: flux complet `/start updates` plus cron.
- `src/test/startDiscountsFlow.e2e.test.ts`: flux complet `/start reduceri` plus cron.
- `src/test/commandRegistry.functional.test.ts`: registrul de comenzi cu installer-e mock.
- `src/test/sourceRegistry.functional.test.ts`: registrul de surse cu installer-e mock.
- `src/test/dealFiltersCore.functional.test.ts`: filtrele de reduceri si helperii de normalizare.
- `src/test/httpClientSecurity.test.ts`: URL guard si proxy fallback.
- `src/test/resolveOutboundChannel.test.ts`: erori Discord permanente vs tranzitorii.
- `src/test/rustFuzzy.test.ts`: addon-ul Rust si fallback contract.

## Verificare live

Testele automate nu pot confirma complet comportamentul live fara `DISCORD_TOKEN`, Mongo si surse reale. Pentru release public, rularea pe un server Discord de staging ramane verificarea finala, separat de CI si fara secrete in repository.
