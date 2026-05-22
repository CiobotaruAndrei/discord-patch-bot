# V11 - stare curenta si schimbari utile

Acest document noteaza starea repo-ului dupa curatare, migrarea sursei la TypeScript, introducerea graduala a Rust, setup-ul de CI/Docker si ultimele imbunatatiri pentru testare, release, GHCR, securitate, dependinte npm si reducerea treptata a contextului legacy.

## Stare curenta

- Codul editabil al aplicatiei este in `src/`.
- JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala.
- Dependintele sunt blocate prin `src/package-lock.json`, iar CI foloseste `npm ci`.
- `src/package.json` foloseste versiuni exacte pentru dependintele directe runtime si build/dev.
- `src/tsconfig.json` ruleaza proiectul cu `strict: true` si `noImplicitAny: true`.
- `src/tsconfig.strict.json` include zone stabilizate explicit: health, scheduler, `filtersCore`, `commandRegistry`, `slashCommands`, `subscriptionInteractions`, `gameFilterInteractions`, `rolePingInteractions`, `adminCommandGuard`, `adminGuard`, `handlers/help`, `outboundChannel`, `sourceRegistry`, `check-dependencies`, `extract-release-notes`, HTTP client si teste directe.
- `src/legacy-dynamic.d.ts` ramane doar shim temporar pentru codul vechi care construieste contextul dinamic.
- `.github/workflows/ci.yml` ruleaza verificarea principala.
- `.github/workflows/dependency-audit.yml` ruleaza audit npm saptamanal si manual.
- `.github/workflows/dependency-review.yml` ruleaza Dependency Review pe PR-uri care ating manifestele npm sau workflow-urile si devine blocant cand GitHub Dependency graph este activ.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript la push, PR, saptamanal si manual.
- `.github/workflows/release.yml` ruleaza `npm run check`, extrage notele pentru tag-ul curent din `CHANGELOG.md`, publica imaginea Docker in GHCR si creeaza GitHub Release pentru tag-uri `v*.*.*`.
- `Dockerfile` ruleaza runtime-ul ca user non-root `node`.
- `.github/dependabot.yml` deschide PR-uri saptamanale pentru dependinte npm din `src` si pentru GitHub Actions.
- `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTEXT_REPO_CLEAN.md` si `FUNCTION_MAP_CLEAN.md` au fost actualizate cu noile verificari si refactorizari.

## Rectificari recente din feedback

- `src/features/commands/adminGuard.ts` verifica runtime daca utilizatorul are Administrator.
- `src/features/commands/adminCommandGuard.ts` inveleste comenzile `/start`, `/stop` si `/set` si blocheaza non-adminii inainte de a ajunge la handler-ele care schimba starea serverului.
- `src/features/commands/handlers/help.ts` extrage `/help` intr-un handler mic, testabil si instalat peste handlerul legacy.
- `src/features/commands/slashCommands.ts` a fost adaugat in `tsconfig.strict.json` si foloseste tipuri locale pentru builder-ele Discord in loc de multe callback-uri `any`.
- `src/scripts/extract-release-notes.ts` extrage doar sectiunea tag-ului curent din `CHANGELOG.md`, iar release workflow-ul foloseste `release-notes.md` in loc de tot changelog-ul.
- `Dockerfile` face `chown` pe `/app` si trece pe `USER node` in runtime.
- `dependency-review.yml` nu mai foloseste `continue-on-error: true` pe pasul de review. Workflow-ul verifica intai daca GitHub Dependency graph este activ; cand este activ, `actions/dependency-review-action@v4` ruleaza ca verificare blocanta pentru vulnerabilitati moderate sau mai grave.
- `src/package.json` pin-uieste exact si build/dev dependencies directe, inclusiv `@napi-rs/cli`.
- `src/scripts/check-dependencies.ts` verifica runtime si build/dev dependencies directe, plus versiunile rezolvate in lockfile si URL-urile din registry npm.
- `src/features/commands/rolePingInteractions.ts` extrage `/set role updates/discounts` intr-o factory tipata cu dependinte explicite.
- `README.md` mentioneaza explicit ca testele CI nu pot confirma comportamentul live complet fara server Discord, token, Mongo si surse externe reale.

## Reducerea treptata a ctx legacy

Codul inca are module CommonJS care ataseaza functii pe un context comun. Directia corecta este migrarea treptata spre servicii/factory-uri tipate. Pasi deja facuti:

- `src/features/commands/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)` pentru installer-e injectate explicit.
- `src/features/commands/adminCommandGuard.ts` este un wrapper exterior pentru comenzile admin si foloseste `adminGuard` inainte de delegare.
- `src/features/commands/handlers/help.ts` expune `createHelpHandler(deps)` si intercepteaza doar `/help`.
- `src/features/commands/subscriptionInteractions.ts` expune `createSubscriptionInteractionHandlers(deps)` si un installer care intercepteaza comenzile `/start` si `/stop`.
- `src/features/commands/gameFilterInteractions.ts` expune `createGameFilterInteractionHandlers(deps)` si un installer care intercepteaza doar `/set games`.
- `src/features/commands/rolePingInteractions.ts` expune `createRolePingInteractionHandlers(deps)` si un installer care intercepteaza doar `/set role`.
- `src/sources/sourceRegistry.ts` expune `createSourceRegistry(baseContext, installers)` pentru surse injectate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure si tipate direct.
- `src/domain/deals/filters.ts` ramane doar adapter pentru contextul legacy.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat.
- `src/features/notifications/index.ts` foloseste `createOutboundChannelResolver`, dar pastreaza adapter-ul legacy pe `ctx`.

Urmatoarele zone bune de refactorizat sunt restul din `features/commands/interactions.ts` (`latest`, `dlc`, `status`, autocomplete) si persistenta din `features/notifications/index.ts`, in pasi separati si cu teste functionale langa fiecare extragere.

## Dependinte npm si supply chain

- Runtime dependencies si build/dev dependencies directe din `src/package.json` sunt versiuni exacte.
- `src/package-lock.json` ramane sursa de instalare reproductibila prin `npm ci`.
- `npm run check:dependencies` pica daca runtime/dev deps directe nu sunt exacte, daca intrarile directe din lockfile nu rezolva la versiunile asteptate sau daca o intrare de lockfile vine din alta sursa decat registry npm peste HTTPS.
- `Dependency Review` verifica PR-urile inainte de merge si completeaza auditul saptamanal. Cand Dependency graph este activ in setarile repo-ului, review-ul este blocant.
- Dependabot ramane util, dar PR-urile lui trebuie citite, nu acceptate automat.

## Build, CI si release

- `src/package.json` separa build Rust, build TypeScript, start, dev, typecheck, strict, test, audit si dependency check.
- `.github/workflows/ci.yml` ruleaza `npm run check` in `src` cu Node.js 20 si Rust stable.
- `.github/workflows/dependency-audit.yml` ruleaza audit runtime saptamanal.
- `.github/workflows/dependency-review.yml` ruleaza review pe PR-uri cu dependency/workflow changes.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript.
- `.github/workflows/release.yml` ruleaza `npm run check`, genereaza `release-notes.md` din sectiunea tag-ului curent, construieste Dockerfile-ul, publica imaginea in GHCR si creeaza GitHub Release.
- Un release real devine vizibil dupa ce `main` primeste un tag semver, de exemplu `v1.0.0` pentru primul release public.

## Acoperire de teste

- `src/test/adminGuard.test.ts` verifica helper-ul de runtime admin si wrapper-ul care blocheaza comenzile admin inainte de delegare.
- `src/test/helpHandler.functional.test.ts` verifica handler-ul extras pentru `/help` si wrapper-ul care deleaga comenzile non-help.
- `src/test/extractReleaseNotes.test.ts` verifica extragerea notelor de release pentru tag-ul curent.
- `src/test/rolePingInteractions.functional.test.ts` verifica factory-ul explicit pentru `/set role` si wrapper-ul care deleaga comenzile non-role.
- `src/test/gameFilterInteractions.functional.test.ts` verifica factory-ul explicit pentru `/set games` si wrapper-ul care deleaga comenzile non-game-filter.
- `src/test/subscriptionInteractions.functional.test.ts` verifica factory-ul explicit pentru `/start`/`/stop` si wrapper-ul instalat in command context.
- `src/test/startUpdatesFlow.e2e.test.ts` verifica fluxul complet `/start updates`, baseline-ul Mongo, cron-ul, trimiterea embed-ului si marcarea `seen`.
- `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxul complet `/start reduceri`, baseline-ul reducerilor, cron-ul, trimiterea embed-ului si marcarea `seenDiscounts`.
- `src/test/sourceRegistry.functional.test.ts`, `src/test/commandRegistry.functional.test.ts`, `src/test/dealFiltersCore.functional.test.ts`, `src/test/httpClientSecurity.test.ts`, `src/test/resolveOutboundChannel.test.ts` si restul testelor raman guard-uri pentru modulele stabilizate.

## Limita verificarii automate

CI si testele E2E locale confirma fluxurile cu mock-uri si DB controlat. Comportamentul live complet necesita un server Discord de staging, token real, Mongo si surse externe reale; aceasta verificare nu trebuie simulata prin secrete puse in repo sau in loguri publice.

## Ce nu am copiat 1:1

Fisierele locale mari au fost tratate ca sursa de idei, nu copiate ca fisiere noi. Repo-ul ramane impartit pe functionalitati, iar fisierele noi din radacina sunt documentatie, exemple vizuale sau infrastructura de rulare/verificare.
