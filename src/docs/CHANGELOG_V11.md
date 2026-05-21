# V11 - stare curenta si schimbari utile

Acest document noteaza starea repo-ului dupa curatare, migrarea sursei la TypeScript, introducerea graduala a Rust, setup-ul de CI/Docker si ultimele imbunatatiri pentru testare, release, GHCR, securitate, dependinte npm si reducerea treptata a contextului legacy.

## Stare curenta

- Codul editabil al aplicatiei este in `src/`.
- JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala.
- Dependintele sunt blocate prin `src/package-lock.json`, iar CI foloseste `npm ci`.
- `src/tsconfig.json` ruleaza proiectul cu `strict: true` si `noImplicitAny: true`.
- `src/tsconfig.strict.json` include zone stabilizate explicit: health, scheduler, `filtersCore`, `commandRegistry`, `subscriptionInteractions`, `gameFilterInteractions`, `outboundChannel`, `sourceRegistry`, `check-dependencies`, HTTP client si teste directe.
- `src/legacy-dynamic.d.ts` ramane doar shim temporar pentru codul vechi care construieste contextul dinamic.
- `.github/workflows/ci.yml` ruleaza verificarea principala.
- `.github/workflows/dependency-audit.yml` ruleaza audit npm saptamanal si manual.
- `.github/workflows/dependency-review.yml` ruleaza Dependency Review pe PR-uri care ating manifestele npm sau workflow-urile.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript la push, PR, saptamanal si manual.
- `.github/workflows/release.yml` ruleaza `npm run check`, publica imaginea Docker in GHCR si creeaza GitHub Release pentru tag-uri `v*.*.*`.
- `.github/dependabot.yml` deschide PR-uri saptamanale pentru dependinte npm din `src` si pentru GitHub Actions.
- `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTEXT_REPO_CLEAN.md` si `FUNCTION_MAP_CLEAN.md` au fost actualizate cu noile verificari si refactorizari.

## Rectificari recente din feedback

- `src/features/commands/gameFilterInteractions.ts` extrage `/set games add/remove/list/reset` intr-o factory tipata cu dependinte explicite.
- `src/features/commands/commandRegistry.ts` instaleaza wrapper-ul `gameFilterInteractions` dupa `subscriptionInteractions`, deci runtime-ul foloseste servicii dedicate pentru `/start`, `/stop` si `/set games`, iar restul comenzilor sunt delegate catre handlerul legacy.
- `src/test/gameFilterInteractions.functional.test.ts` verifica factory-ul si wrapper-ul de dispatch pentru `/set games`.
- `src/scripts/check-dependencies.ts` verifica runtime deps pin-uite exact, alinierea `package.json` -> `package-lock.json` si URL-uri de lockfile catre `https://registry.npmjs.org`.
- `src/package.json` include `npm run check:dependencies`, iar `npm run check` ruleaza si acest guard.
- `.github/workflows/dependency-review.yml` adauga GitHub Dependency Review pe PR-uri, cu fail pe vulnerabilitati moderate sau mai grave.
- `SECURITY.md` documenteaza disciplina pentru PR-urile Dependabot: diff lockfile, Dependency Review, audit, CI si release notes inainte de merge.
- Pentru release real, workflow-ul exista deja si documentatia indica primul tag public `v1.0.0`; crearea tag-ului ramane actiunea necesara ca GitHub sa afiseze un Release public.
- Punctul despre fragilitatea scraping-ului nu a fost lucrat in aceasta runda, conform cerintei de a sari peste punctul 4.

## Reducerea treptata a ctx legacy

Codul inca are module CommonJS care ataseaza functii pe un context comun. Directia corecta este migrarea treptata spre servicii/factory-uri tipate. Pasi deja facuti:

- `src/features/commands/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)` pentru installer-e injectate explicit.
- `src/features/commands/subscriptionInteractions.ts` expune `createSubscriptionInteractionHandlers(deps)` si un installer care intercepteaza comenzile `/start` si `/stop`.
- `src/features/commands/gameFilterInteractions.ts` expune `createGameFilterInteractionHandlers(deps)` si un installer care intercepteaza doar `/set games`.
- `src/sources/sourceRegistry.ts` expune `createSourceRegistry(baseContext, installers)` pentru surse injectate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure si tipate direct.
- `src/domain/deals/filters.ts` ramane doar adapter pentru contextul legacy.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat.
- `src/features/notifications/index.ts` foloseste `createOutboundChannelResolver`, dar pastreaza adapter-ul legacy pe `ctx`.

Urmatoarele zone bune de refactorizat sunt restul din `features/commands/interactions.ts` si persistenta din `features/notifications/index.ts`, in pasi separati si cu teste functionale langa fiecare extragere.

## Dependinte npm si supply chain

- Runtime dependencies din `src/package.json` sunt pin-uite exact.
- `src/package-lock.json` ramane sursa de instalare reproductibila prin `npm ci`.
- `npm run check:dependencies` pica daca runtime deps nu sunt exacte, daca lockfile-ul nu corespunde manifestului sau daca o intrare de lockfile vine din alta sursa decat registry npm peste HTTPS.
- `Dependency Review` verifica PR-urile inainte de merge si completeaza auditul saptamanal.
- Dependabot ramane util, dar PR-urile lui trebuie citite, nu acceptate automat.

## Build, CI si release

- `src/package.json` separa build Rust, build TypeScript, start, dev, typecheck, strict, test, audit si dependency check.
- `.github/workflows/ci.yml` ruleaza `npm run check` in `src` cu Node.js 20 si Rust stable.
- `.github/workflows/dependency-audit.yml` ruleaza audit runtime saptamanal.
- `.github/workflows/dependency-review.yml` ruleaza review pe PR-uri cu dependency/workflow changes.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript.
- `.github/workflows/release.yml` ruleaza `npm run check`, construieste Dockerfile-ul, publica imaginea in GHCR si creeaza GitHub Release.
- Un release real devine vizibil dupa ce `main` primeste un tag semver, de exemplu `v1.0.0` pentru primul release public.

## Acoperire de teste

- `src/test/gameFilterInteractions.functional.test.ts` verifica factory-ul explicit pentru `/set games` si wrapper-ul care deleaga comenzile non-game-filter.
- `src/test/subscriptionInteractions.functional.test.ts` verifica factory-ul explicit pentru `/start`/`/stop` si wrapper-ul instalat in command context.
- `src/test/startUpdatesFlow.e2e.test.ts` verifica fluxul complet `/start updates`, baseline-ul Mongo, cron-ul, trimiterea embed-ului si marcarea `seen`.
- `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxul complet `/start reduceri`, baseline-ul reducerilor, cron-ul, trimiterea embed-ului si marcarea `seenDiscounts`.
- `src/test/sourceRegistry.functional.test.ts`, `src/test/commandRegistry.functional.test.ts`, `src/test/dealFiltersCore.functional.test.ts`, `src/test/httpClientSecurity.test.ts`, `src/test/resolveOutboundChannel.test.ts` si restul testelor raman guard-uri pentru modulele stabilizate.

## Ce nu am copiat 1:1

Fisierele locale mari au fost tratate ca sursa de idei, nu copiate ca fisiere noi. Repo-ul ramane impartit pe functionalitati, iar fisierele noi din radacina sunt documentatie, exemple vizuale sau infrastructura de rulare/verificare.
