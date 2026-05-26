# V11 - stare curenta si schimbari utile

Acest document noteaza starea repo-ului dupa curatare, migrarea la TypeScript, introducerea optionala a Rust/N-API, setup-ul de CI/Docker si ultimele imbunatatiri pentru testare, release, GHCR, securitate, dependinte npm si reducerea treptata a contextului legacy.

## Stare curenta

- Codul editabil al aplicatiei este in `src/`.
- JavaScript-ul ramas este output generat in `dist/` sau loader N-API generat, nu sursa manuala principala.
- Dependintele sunt blocate prin `package-lock.json`, iar CI foloseste `npm ci`.
- `package.json` foloseste versiuni exacte pentru dependinte directe runtime si build/dev.
- TypeScript strict este aplicat incremental prin `src/tsconfig.strict.json` pe module stabilizate.
- Zona de comenzi este impartita pe functionalitati: `commands`, `command-handlers`, `command-cache`, `command-definitions`, `command-presentation`, `command-registry`, `command-runtime` si `command-security`.
- `src/features/command-router/` nu mai este structura curenta. Vechiul router a fost retras si inlocuit cu `src/features/command-handlers/fallbackInteractionHandler.ts`.
- Handler-ele pentru `/ping`, `/games`, `/help`, `/start`, `/stop`, `/set`, `/latest`, `/dlc`, `/status` si autocomplete sunt in `src/features/command-handlers/`.
- `interactions.ts` ramane router/wiring si trebuie sa delege catre handler-e dedicate.
- `notifications/index.ts` este wiring; logica principala pentru update-uri si reduceri este in `updateNotificationService.ts` si `discountNotificationService.ts`.
- `seenRepository.ts` gestioneaza deduplicarea pentru update-uri si reduceri.
- `outboundChannel.ts` izoleaza rezolvarea canalului Discord.
- `src/native/` contine Rust/N-API pentru hot-path-uri pure: fuzzy matching, hash-uri, normalizare/scoring si filtrarea ofertelor.
- `Dockerfile` ruleaza runtime-ul ca user non-root.
- Workflow-urile GitHub acopera CI, CodeQL, dependency review, audit si release cu GHCR.
- `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTEXT_REPO_CLEAN.md` si `FUNCTION_MAP_CLEAN.md` sunt documentele principale care trebuie tinute sincronizate cu schimbarile de cod.

## Rectificari importante aplicate

### Dependinte si reproducibilitate

- A fost adaugat lockfile, iar CI foloseste `npm ci`.
- Dependintele directe runtime si dev/build sunt pin-uite exact.
- `check-dependencies` verifica manifestul si lockfile-ul.
- Dependabot si dependency review sunt configurate pentru npm si GitHub Actions.

### TypeScript si organizare

- Codul a fost mutat din fisiere plate spre foldere numite dupa functionalitate.
- Handler-ele de comenzi au fost extrase treptat din fisierul mare legacy.
- `fallbackInteractionHandler.ts` a inlocuit vechiul `legacyInteractionRouter.ts` si ramane doar fallback de final.
- `slashCommandDefinitions.ts` foloseste tipuri locale pentru builder-ele Discord si reduce folosirea `any`.
- `src/tsconfig.strict.json` include incremental fisiere stabilizate, nu tot proiectul brusc.

### Securitate

- Comenzile administrative au guard runtime prin `adminPermissionGuard.ts` si `adminCommandRouterGuard.ts`.
- `/metrics` poate fi protejat cu token.
- Docker ruleaza procesul ca user non-root.
- `SECURITY.md` documenteaza raportarea vulnerabilitatilor.
- CodeQL ruleaza pentru JavaScript/TypeScript.

### Notificari si cron

- `notifications/index.ts` a fost redus la wiring.
- `updateNotificationService.ts` proceseaza update-uri, deduplicare si trimitere embed-uri.
- `discountNotificationService.ts` proceseaza reduceri, deduplicare si trimitere embed-uri.
- `seenRepository.ts` centralizeaza operatiile Mongo pentru itemele deja vazute.
- Cron-ul foloseste guard-uri pentru lock, heartbeat, cooldown-uri si erori partiale.

### Robustete runtime

- Shutdown-ul asteapta inchiderea HTTP server-ului in limita unui buget.
- Health/metrics trateaza erorile din handler si query string-uri.
- HTTP client-ul respecta `Retry-After`, inclusiv format HTTP-date.
- Circuit breaker-ul acopera si schema drift pentru surse externe.
- Scraping-ul ramane zona fragila prin natura surselor externe, dar exista fallback-uri, logging si teste de regresie.

### Rust/N-API

- `dealPassesFilters` a fost mutat in Rust pentru hot-path-ul pur de filtrare oferte, apelat in cron si in `/latest reduceri`.
- `src/native/fuzzy.ts` pastreaza fallback TypeScript identic, deci botul ramane functional daca addon-ul nativ nu este disponibil.
- `dealFiltersCore.ts` ramane API-ul domain-level folosit de restul aplicatiei.

## Organizarea pe functionalitati

Structura recomandata pentru zona de comenzi este:

- `src/features/command-registry/commandRegistry.ts`: instaleaza module si valideaza functii necesare.
- `src/features/command-runtime/commandRuntimeContext.ts`: construieste contextul comun ramas.
- `src/features/command-handlers/simpleCommandsHandler.ts`: `/ping` si `/games`.
- `src/features/command-handlers/helpInteractionHandler.ts`: `/help` si paginare help.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts`: `/start` si `/stop`.
- `src/features/command-handlers/gameFilterHandlers.ts`: `/set games`.
- `src/features/command-handlers/rolePingHandlers.ts`: `/set role`.
- `src/features/command-handlers/setInteractionHandler.ts`: subcomenzi directe `/set`.
- `src/features/command-handlers/latestInteractionHandler.ts`: `/latest`.
- `src/features/command-handlers/dlcInteractionHandler.ts`: `/dlc`.
- `src/features/command-handlers/statusInteractionHandler.ts`: `/status`.
- `src/features/command-handlers/autocompleteInteractionHandler.ts`: autocomplete.
- `src/features/command-handlers/fallbackInteractionHandler.ts`: fallback de final pentru interactiuni necunoscute.

Nu reintroduce un router mare pentru toate comenzile. Daca apare o comanda noua, creeaza un handler numit dupa functionalitatea ei.

## Reducerea treptata a ctx legacy

Proiectul inca are zone care folosesc context comun si wiring dinamic. Directia ramane migrarea spre servicii/factory-uri cu dependinte explicite.

Pasi deja facuti:

- handler-e separate pentru comenzile principale;
- guard-uri de admin ca servicii reutilizabile;
- servicii separate pentru notificari update/reduceri;
- resolver de canal outbound separat;
- repository de seen items separat;
- filtre pure pentru deal/update logic;
- `dealPassesFilters` delegat prin Rust/N-API cu fallback TypeScript;
- source registry si command registry mai explicite.

Urmatoarele zone de refactorizat:

- reducerea contextului comun din `commandRuntimeContext` si `commandRegistry`;
- inlocuirea ultimelor `any` din builder-e si interactiuni Discord.js unde exista tipuri concrete;
- pastrarea `interactions.ts` si `notifications/index.ts` ca adaptoare subtiri;
- continuarea includerii in `src/tsconfig.strict.json` doar dupa ce fisierele sunt stabile.

## Build, CI si release

- `npm run build` compileaza proiectul.
- `npm start` ruleaza codul compilat.
- `npm run check` trebuie sa fie comanda principala de validare in CI.
- Workflow-ul de release poate publica GitHub Release si imagine GHCR cand este impins un tag semver `v*.*.*`.
- Release-ul devine vizibil doar dupa tag real, de exemplu `v1.0.0`.

## Teste relevante

Teste functionale si E2E care trebuie mentinute:

- `simpleCommandsHandler.functional.test.ts`;
- `helpHandler.functional.test.ts`;
- `subscriptionInteractions.functional.test.ts`;
- `gameFilterInteractions.functional.test.ts`;
- `rolePingInteractions.functional.test.ts`;
- `setInteractionHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`;
- `startUpdatesFlow.e2e.test.ts`;
- `startDiscountsFlow.e2e.test.ts`.

## Limita verificarii automate

CI si testele E2E locale confirma fluxurile cu mock-uri si DB controlat. Comportamentul live complet necesita server Discord de staging, token real, MongoDB real si surse externe reale. Aceste secrete nu trebuie puse in repo sau in loguri publice.

## Regula de mentenanta

De fiecare data cand se muta sau modifica logica, actualizeaza si documentatia relevanta: `README.md`, `CHANGELOG.md`, `CONTEXT_REPO_CLEAN.md`, `FUNCTION_MAP_CLEAN.md` si acest document daca starea arhitecturii s-a schimbat.
