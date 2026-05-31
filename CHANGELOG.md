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
- Coada dead-letter pentru livrarile de notificari care epuizeaza toate reincercarile. Cand un update sau o reducere nu poate fi trimisa nici dupa `PENDING_UPDATE_MAX_ATTEMPTS` / `PENDING_DISCOUNT_MAX_ATTEMPTS`, in loc sa fie aruncata silentios, intrarea este persistata in campul `notificationDeadLetter` de pe documentul guild-ului (kind, itemId, titlu, motiv, numar de incercari, moment), plafonat la ultimele `NOTIFICATION_DEAD_LETTER_LIMIT` intrari prin `$slice`. Ofera vizibilitate asupra livrarilor esuate definitiv si nu pierde informatia la restart. Acoperit de teste functionale noi in `notificationServices.functional.test.ts`.
- Event store pentru faza de fetch: dupa fiecare ciclu cron reusit, rezultatele normalizate sunt persistate intr-o colectie DB (`FetchSnapshotModel`, prin `saveFetchSnapshot`) — `updates` pentru lista completa de update-uri si `deals:<MONEDA>` pentru reduceri. La pornire, `main.ts` hidrateaza cache-urile in-memory din aceste snapshot-uri (`loadFetchSnapshot` / `loadDealsFetchSnapshots`) daca sunt suficient de proaspete, astfel incat comenzile (`/latest`, reduceri) servesc imediat ultimele date dupa un restart, fara cache rece pana la urmatorul cron. Scrierile sunt best-effort (nu blocheaza cron-ul), documentele au TTL, iar acesta este si fundamentul peste care un dispatcher separat (pasul urmator) va putea citi evenimentele. Acoperit de teste in `fetchSnapshots.functional.test.ts`.

### Changed

- Conditional GET (ETag / Last-Modified) pentru sursele de update-uri cu un singur fetch (Steam, Minecraft, Roblox, Nvidia). Clientul HTTP expune `conditionalGet(url, parse)`: tine minte `etag` / `last-modified` per URL si trimite `If-None-Match` / `If-Modified-Since` la urmatorul check; daca serverul raspunde `304 Not Modified`, reuseaza rezultatul parsat anterior fara sa redescarce sau sa reparseze corpul. `httpReq` accepta acum `acceptNotModified`, astfel incat un `304` nu mai e tratat ca eroare. Inofensiv cand serverul nu suporta validatori (face un GET normal). Acoperit de teste in `conditionalGet.test.ts`.
- Trimiterile catre Discord sunt acum grupate: in loc de cate un mesaj per update/reducere, fiecare guild primeste un singur mesaj cu pana la 10 embed-uri (limita Discord) pe trimitere, in pachete pana la `MAX_UPDATES_PER_CYCLE` / `MAX_DEALS_PER_CYCLE`. Reduce numarul de request-uri Discord, latenta si presiunea pe rate limit. Itemii sunt claim-uiti (`seen`) inainte de trimitere; daca un mesaj esueaza, tot pachetul lui se face rollback si re-coadeaza (sau intra in dead-letter la epuizarea reincercarilor), iar ping-ul de rol apare o singura data, pe primul mesaj. Acoperit de teste in `notificationServices.functional.test.ts`.
- Cron-ul are acum jitter si cycle budget. `CRON_JITTER_MS` adauga un offset aleator (+/-) la fiecare programare a urmatorului ciclu, ca instantele multiple sa nu se trezeasca simultan si sa se loveasca pe lock-ul Mongo. `CRON_CYCLE_BUDGET_MS` (implicit un `CRON_INTERVAL_MS`) face ca, daca un ciclu dureaza prea mult, urmatorul sa sara peste reduceri o data pentru recuperare (backpressure soft). `.env.example` include si preset-uri de tuning recomandate pentru bot mic/mediu si multe servere. Acoperit de teste in `cronController.test.ts`.
- Faza de dispatch (cron) este acum rezistenta la caderea fetch-ului prin event store: daca `getLatestForAllGames` (update-uri) sau `fetchDeals` (reduceri, per moneda) esueaza, in loc sa abandoneze ciclul / sa sara guild-ul, dispatch-ul citeste ultimul snapshot persistat (`loadFetchSnapshot` — `updates` respectiv `deals:<MONEDA>`) si continua trimiterile de pe ultimele date bune. Deduplicarea `seen` previne re-trimiterea, iar TTL-ul snapshot-ului limiteaza vechimea; daca nu exista snapshot, comportamentul ramane cel vechi (abandon/skip). Astfel dispatch-ul nu mai depinde de un fetch reusit in acel moment. Acoperit de teste in `fetchSnapshots.functional.test.ts`.
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
- Documentatia interna a fost sincronizata cu structura actuala si nu mai prezinta `command-router` ca arhitectura curenta.
- Documentatia istorica versionata si `legacy-dynamic.d.ts` au fost eliminate.
- Comentariile explicative au fost eliminate din fisierele de cod; informatia de arhitectura si mentenanta ramane in documentatie.
- Testele din `auditFixesMay26.test.ts` verifica acum comportamentul real (eroare tranzitorie din `fetchListingBasedUpdate`, robustetea `findGameKeys` la emoji multi-codepoint) prin context fals, in loc sa citeasca fisierele sursa ca text si sa caute siruri.
- Installerele `attachCommandCache` si `attachCommandUi` nu mai paseaza intregul `target` comun catre factory-uri; construiesc un obiect `deps` explicit, restrans, cu doar cheile declarate, tipat pe interfata factory-ului asa incat TypeScript impune completitudinea. Reduce cuplajul: factory-urile nu mai pot accesa accidental chei nedeclarate din punga comuna.
- S-au reintrodus, ca exceptie documentata de la regula „fara comentarii", doua note scurte de o linie la punctele de concurenta din `cron.ts` (invalidarea tokenului inainte de oprirea heartbeat-ului/eliberarea lock-ului si re-armarea heartbeat-ului doar cat timp lock-ul ramane al instantei), pentru a preveni reintroducerea unui race condition la reinnoirea lock-ului.
- Toate handler-ele de comenzi (`simpleCommands`, `status`, `autocomplete`, `dlc`, `gameFilter`, `rolePing`, `set`, `subscription`, `help`, fallback) si agregatorul `latest` primesc acum un obiect `deps` explicit, restrans, in loc de intregul `target` comun, continuand modelul aplicat la `commandCache` si `commandPresentation`. La `latest`, tipul `deps` a devenit intersectia explicita a celor patru sub-handlere (fara index signature), astfel incat TypeScript impune lista completa de dependinte si factory-urile nu mai pot accesa chei nedeclarate din punga comuna.
- Stratul de wiring nu mai vehiculeaza un singleton mutabil netipat. `commandRuntimeContext.ts` nu mai exporta un obiect global construit prin spread, ci o factory tipata `createCommandRuntimeContext()` (cu interfata explicita `DiscordRuntimeBindings` pentru constructorii discord.js). `commandRegistry.ts` construieste acum un context proaspat la fiecare apel `createCommandRegistry` in loc sa mute un singleton global comun, ceea ce elimina starea globala partajata si riscul de dublare a lantului `handleInteraction` daca registry-ul ar fi construit de mai multe ori.
- Toate trimiterile catre Discord trec acum printr-un rate limiter global de tip token bucket (`createDiscordRateLimiter`), aplicat intr-un singur punct: canalul intors de `resolveOutboundChannel` are `send` impachetat ca sa astepte un slot inainte de trimitere. Plafoneaza rafalele peste delay-ul per-trimitere existent; `acquire()` nu blocheaza niciodata mai mult de `DISCORD_SEND_RATE_MAX_WAIT_MS`, deci o configurare gresita nu poate bloca notificarile. Configurabil prin `DISCORD_SEND_RATE_CAPACITY`, `DISCORD_SEND_RATE_PER_SEC`, `DISCORD_SEND_RATE_MAX_WAIT_MS`.

### Fixed

- `buildDealEmbed` limiteaza procentul de reducere la intervalul `[0, 100]`; un snapshot `pendingDiscounts` corupt sau reluat (de ex. `savings: 999`) nu mai poate afisa valori imposibile precum `reducere de 999%`.
- Fallback-ul TypeScript `extractDateScore` (folosit cand addon-ul Rust nu este compilat) scaneaza acum tot URL-ul dupa prima data `YYYY-MM-DD` valida, identic cu implementarea Rust. Anterior se uita doar la prima potrivire de tipar; daca aceasta avea un an/luna/zi in afara intervalului (de ex. un an de arhiva `1999-...` sau un grup numeric `5566-77-88` inaintea datei reale), intorcea `0` si nu mai cauta o data valida ulterioara, ceea ce putea face ca sortarea candidatilor `listing_based` dupa data sa aleaga articolul gresit drept „cel mai recent”.

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
