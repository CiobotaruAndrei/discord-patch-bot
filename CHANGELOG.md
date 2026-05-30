# Changelog

Toate schimbarile importante ale proiectului sunt documentate aici.

Formatul urmeaza ideea din [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), iar versiunile folosesc [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Documentatie publica completa pentru setup, variabile `.env`, comenzi, teste, Docker si release.
- `SECURITY.md` pentru raportarea vulnerabilitatilor.
- `LICENSE` MIT.
- `.env.example` cu variabilele importante pentru Discord, MongoDB, cron, health/metrics, logging si proxy.
- Teste functionale pentru fluxurile principale de comenzi, notificari, repository-ul `seen` si E2E pentru update-uri/reduceri.
- Teste directe pentru shape drift in `sources/updates`, `sources/deals` si `sources/steam`.
- Workflow de release pregatit pentru GitHub Release si imagine Docker GHCR la tag-uri `v*`.
- Script `npm run test:e2e` (referit deja in README) care ruleaza fluxurile E2E de update-uri si reduceri.
- Serviciu `mongo:7` in job-ul de CI plus un test de integrare (`mongoLocks.integration.test.ts`) care valideaza lock-ul distribuit (acquire/renew/release) pe un MongoDB real; testul se skip-uieste curat cand nu exista un server pe `MONGO_URI`, deci suita locala ramane verde fara Mongo.

### Changed

- Build-ul si start-ul sunt separate: `npm run build` compileaza, iar `npm start` ruleaza `dist/app/main.js`.
- CI foloseste `npm ci` pe baza `package-lock.json`.
- Dependintele runtime si dev sunt pin-uite exact in `package.json` si lockfile.
- Docker Compose nu mai expune MongoDB pe host implicit; serviciul este accesibil doar in reteaua interna Docker.
- Dockerfile ruleaza procesul runtime ca user non-root.
- Codul este organizat pe functionalitati sub `src/`: `app`, `config`, `domain`, `features`, `infra`, `shared`, `sources` si `native`.
- Handler-ele pentru `/ping`, `/games`, `/help`, `/start`, `/stop`, `/set`, `/latest`, `/dlc`, `/status` si autocomplete sunt extrase in `src/features/command-handlers/`.
- `commandRegistry.ts` ramane strat de wiring pentru modulele de comenzi, nu fisier cu logica de business.
- `fallbackInteractionHandler.ts` inlocuieste vechiul router legacy si ramane doar fallback de final pentru interactiuni neacoperite.
- `notifications/index.ts` a fost redus la wiring; logica pentru update-uri si reduceri este in `updateNotificationService.ts` si `discountNotificationService.ts`.
- `commandCache.ts`, `commandPresentation.ts` si `mongoContext.ts` expun factory-uri explicite, cu atasare pe context pastrata doar pentru compatibilitate.
- Handler-ele de start/stop, filtre jocuri, roluri, prezentarea comenzilor, registry-urile de surse/Mongo si scrapers principali folosesc acum tipuri structurale locale in runtime, fara tipuri wildcard nesigure.
- Abrevierea runtime de context a fost eliminata din codul principal; modulele ramase in stil compatibil folosesc `target` pentru atasare si `deps` pentru dependinte explicite.
- Testele functionale si E2E au fost curatate de abrevierile legacy de context si de tipurile wildcard nesigure, folosind mock-uri structurale si cast-uri prin `unknown` acolo unde se testeaza input invalid.
- Helper-ele de test si variabilele de wiring folosesc nume explicite precum `makeContext`, `runtimeContext` si `validationContext`.
- Filtrarea ofertelor foloseste acum Rust/N-API pentru hot-path-ul pur `dealPassesFilters`, cu fallback TypeScript identic cand addon-ul nativ lipseste.
- Autocomplete-ul pentru jocuri foloseste acum Rust/N-API pentru scoring, sortare si limitarea optiunilor Discord, cu fallback TypeScript identic.
- Alegerea celui mai bun rezultat din cautarea Steam foloseste acum Rust/N-API pentru normalizare, penalizare DLC/demo si Levenshtein, cu fallback TypeScript identic.
- Documentatia interna a fost sincronizata cu structura actuala si nu mai prezinta `command-router` ca arhitectura curenta.
- Documentatia istorica versionata si `legacy-dynamic.d.ts` au fost eliminate.
- Comentariile explicative au fost eliminate din fisierele de cod; informatia de arhitectura si mentenanta ramane in documentatie.
- README-ul descrie comenzile reale pentru `/set games ...` si `/status <joc>`.
- Testele din `auditFixesMay26.test.ts` verifica acum comportamentul real (eroare tranzitorie din `fetchListingBasedUpdate`, robustetea `findGameKeys` la emoji multi-codepoint) prin context fals, in loc sa citeasca fisierele sursa ca text si sa caute siruri.
- Installerele `attachCommandCache` si `attachCommandUi` nu mai paseaza intregul `target` comun catre factory-uri; construiesc un obiect `deps` explicit, restrans, cu doar cheile declarate, tipat pe interfata factory-ului asa incat TypeScript impune completitudinea. Reduce cuplajul: factory-urile nu mai pot accesa accidental chei nedeclarate din punga comuna.
- S-au reintrodus, ca exceptie documentata de la regula „fara comentarii", doua note scurte de o linie la punctele de concurenta din `cron.ts` (invalidarea tokenului inainte de oprirea heartbeat-ului/eliberarea lock-ului si re-armarea heartbeat-ului doar cat timp lock-ul ramane al instantei), pentru a preveni reintroducerea unui race condition la reinnoirea lock-ului.
- Toate handler-ele de comenzi (`simpleCommands`, `status`, `autocomplete`, `dlc`, `gameFilter`, `rolePing`, `set`, `subscription`, `help`, fallback) si agregatorul `latest` primesc acum un obiect `deps` explicit, restrans, in loc de intregul `target` comun, continuand modelul aplicat la `commandCache` si `commandPresentation`. La `latest`, tipul `deps` a devenit intersectia explicita a celor patru sub-handlere (fara index signature), astfel incat TypeScript impune lista completa de dependinte si factory-urile nu mai pot accesa chei nedeclarate din punga comuna.
- Stratul de wiring nu mai vehiculeaza un singleton mutabil netipat. `commandRuntimeContext.ts` nu mai exporta un obiect global construit prin spread, ci o factory tipata `createCommandRuntimeContext()` (cu interfata explicita `DiscordRuntimeBindings` pentru constructorii discord.js). `commandRegistry.ts` construieste acum un context proaspat la fiecare apel `createCommandRegistry` in loc sa mute un singleton global comun, ceea ce elimina starea globala partajata si riscul de dublare a lantului `handleInteraction` daca registry-ul ar fi construit de mai multe ori.
- `fetchListingBasedUpdate` pre-calculeaza scorul de keyword si scorul de data o singura data per candidat (decorate-sort-undecorate), in loc sa le recalculeze in comparatorul de sortare. Reduce apelurile catre Rust/N-API (`scoreListingCandidate`, `extractDateScore`) de la O(n log n) la O(n) pe un hot-path rulat in fiecare ciclu cron pentru fiecare sursa `listing_based`; ordinea rezultata (scor keyword desc, apoi data desc, apoi pozitie asc) ramane identica.
- `fetchDeals` preia sursele Steam (specials + batch-uri de review-uri) si Epic (GraphQL) in paralel prin `Promise.all`, in loc secvential. Latenta unui ciclu de oferte scade de la `Steam + Epic` la aproximativ `max(Steam, Epic)` pe cron si pe `/latest reduceri`; fiecare sursa pastreaza propriul `try/catch` (una care esueaza nu o blocheaza pe cealalta), iar ordinea de imbinare ramane `[Steam, Epic]`, deci deduplicarea si rezultatul final sunt identice.
- Sectiunea „Comenzi principale" din README descrie acum corect subcomenzile `/set` reale (`mode`, `mindiscount`, `maxprice`, `free`, `paid`, `currency`, `stores`, plus `/set games ...` si `/set role ...`), fara intrari duplicate.

### Fixed

- `buildDealEmbed` limiteaza procentul de reducere la intervalul `[0, 100]`; un snapshot `pendingDiscounts` corupt sau reluat (de ex. `savings: 999`) nu mai poate afisa valori imposibile precum `reducere de 999%`.
- Fallback-ul TypeScript `extractDateScore` (folosit cand addon-ul Rust nu este compilat) scaneaza acum tot URL-ul dupa prima data `YYYY-MM-DD` valida, identic cu implementarea Rust. Anterior se uita doar la prima potrivire de tipar; daca aceasta avea un an/luna/zi in afara intervalului (de ex. un an de arhiva `1999-...` sau un grup numeric `5566-77-88` inaintea datei reale), intorcea `0` si nu mai cauta o data valida ulterioara, ceea ce putea face ca sortarea candidatilor `listing_based` dupa data sa aleaga articolul gresit drept „cel mai recent”.
- Workflow-ul de release ruleaza `Run release checks` (`npm run check`) cu acelasi `env` ca CI (`MONGO_URI`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `METRICS_PUBLIC`). Anterior pasul nu seta aceste variabile, desi validarea env le cere, astfel incat `npm run check` putea esua la release desi trecea in CI.

### Security

- Comenzile administrative au verificari runtime de administrator in handler-ele sensibile, pe langa permisiunile slash command declarate.
- Endpoint-ul `/metrics` poate fi protejat cu token si comparatie `timingSafeEqual`.
- Workflow-ul de dependency review poate bloca PR-uri cand Dependency Graph este disponibil.
- Dependabot este configurat pentru actualizari npm si GitHub Actions.
- Clientul HTTP valideaza hosturile prin URL + DNS/IP inainte de request si prin lookup-ul agentului, pentru protectie SSRF mai stricta.

## [1.0.0] - 2026-05-21

### Added

- Bot Discord pentru update-uri, DLC-uri si reduceri.
- Slash commands pentru `/start`, `/stop`, `/set`, `/latest`, `/dlc`, `/status` si `/help`.
- Persistenta MongoDB pentru guild-uri, jocuri urmarite si elemente deja vazute.
- Cron jobs pentru update-uri si reduceri.
- Parsere si fallback-uri pentru surse externe.
- Health check si metrics locale.
- Teste pentru parsere, filtre, cooldown-uri, deduplicare si guard-uri principale.
- Dockerfile si docker-compose pentru rulare locala.
