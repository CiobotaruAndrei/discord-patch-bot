# Function map curat

Harta responsabilitatilor pentru structura curenta a proiectului. Foloseste acest fisier cand muti cod, redenumesti fisiere sau verifici daca documentatia mai corespunde cu repo-ul.

## App

### `src/app/main.ts`

- Porneste aplicatia.
- Incarca env/config.
- Conecteaza MongoDB.
- Creeaza clientul Discord.
- Instaleaza registrul de comenzi, sursele, job-urile si serverul health/metrics.

### `src/app/health/httpServer.ts`

- Expune `/healthz` si `/metrics`.
- Protejeaza metrics cu token optional si comparatie sigura.
- Nu trebuie sa contina logica de business pentru Discord sau scraping.

### `src/app/scheduler/cron.ts`

- Orchestreaza ciclurile de update-uri si reduceri.
- Gestioneaza lock distribuit, heartbeat, health window si abort.
- Nu trebuie sa contina logica de scraping sau de formatat embed-uri.

## Config si shared

### `src/shared/env.ts`

- Citeste si valideaza variabilele de mediu.
- Centralizeaza default-uri si limite numerice.

### `src/config/configLoader.ts`

- Incarca `config.json`.
- Expune lista de jocuri configurate.

### `src/config/configValidator.ts`

- Valideaza schema si cerintele de runtime pentru jocuri si surse.

### `src/shared/errors.ts`, `src/shared/logging.ts`, `src/shared/utilities.ts`

- Utilitare comune folosite de app, surse, comenzi si job-uri.

## Infra

### `src/infra/http/client.ts`

- Client HTTP cu retry, proxy templates, limite de dimensiune si validare URL externa.
- Valideaza hosturile externe si prin DNS/IP, ca request-urile sa nu ajunga in adrese locale sau private.
- Expune `cleanText`, `normalizeUpdate`, `stableUpdateId`, `dealHash` si helper-ele HTTP pe context.
- Foloseste wrapper-ele Rust din `src/native/fuzzy.ts` pentru hot-path-uri pure.

### `src/infra/mongo/models.ts`

- Defineste modelele Mongoose.

### `src/infra/mongo/mongoContext.ts`

- Construieste exporturile Mongo prin `createMongoContext`.
- Atasarea pe context ramane compatibila cu runtime-ul existent.

### `src/infra/mongo/locks.ts`

- Gestioneaza lock-ul distribuit pentru cron.
- Trebuie sa distinga intre lock pierdut si erori Mongo tranzitorii.

## Commands

### `src/features/command-definitions/slashCommandDefinitions.ts`

- Defineste slash commands pentru Discord.
- Seteaza permisiunile declarative pentru comenzile administrative.
- Trebuie sa ramana declarativ, fara logica de executie.

### `src/features/command-registry/commandRegistry.ts`

- Instaleaza modulele de comenzi si interactiuni.
- Leaga handler-ele la contextul runtime.
- Valideaza ca functiile necesare exista.
- Ramane o zona de tranzitie pana cand toate dependintele sunt injectate explicit.

### `src/features/command-runtime/commandRuntimeContext.ts`

- Construieste contextul comun folosit de wiring.
- Este una dintre zonele principale de redus treptat.
- Scopul pe termen lung este sa livreze dependinte mici si tipate catre factory-uri, nu un obiect comun mare de context.

### `src/features/command-cache/commandCache.ts`

- Gestioneaza cache-uri runtime pentru updates, deals, DLC, single lookup si cooldown-uri user.
- Expune `createCommandCache`, iar atasarea pe context ramane adapter de compatibilitate.
- Foloseste tipuri structurale pentru permisiuni/canale, nu tipuri wildcard nesigure.

### `src/features/command-presentation/commandPresentation.ts`

- Construieste embed-uri, paginare, select menus si raspunsuri user-facing.
- Contine helper-ul de fuzzy game lookup prin `findGameKeys` (TS-primary — Rust mai lent pe marshaling-ul NAPI, vezi `BENCHMARKS.md`; nativul ramane pentru benchmark/paritate).
- Expune `createCommandPresentation`, iar instalarea pe context este doar adapter de compatibilitate.
- Builder-ele Discord, collector-ul, interactiunile si raspunsurile HTTP sunt modelate local prin interfete mici.

## Command handlers

### `src/features/command-handlers/simpleCommandsHandler.ts`

- Gestioneaza `/ping` si `/games`.

### `src/features/command-handlers/helpInteractionHandler.ts`

- Gestioneaza `/help` si paginarea help-ului.

### `src/features/command-handlers/subscriptionNotificationHandlers.ts`

- Gestioneaza `/start` si `/stop` pentru update-uri si reduceri.
- Actualizeaza configuratia guild-ului si canalele de notificare.

### `src/features/command-handlers/gameFilterHandlers.ts`

- Gestioneaza `/set games`.
- Normalizeaza si valideaza input-ul pentru jocuri urmarite.

### `src/features/command-handlers/rolePingHandlers.ts`

- Gestioneaza `/set role`.

### `src/features/command-handlers/setInteractionHandler.ts`

- Gestioneaza subcomenzile directe `/set`.
- Trebuie sa aiba verificari runtime pentru administrator in operatiile sensibile.

### `src/features/command-handlers/latestInteractionHandler.ts`

- Gestioneaza `/latest`.
- Citeste ultimele update-uri sau reduceri cunoscute si raspunde cu embed-uri/paginare.

### `src/features/command-handlers/dlcInteractionHandler.ts`

- Gestioneaza `/dlc`.

### `src/features/command-handlers/statusInteractionHandler.ts`

- Gestioneaza `/status`.

### `src/features/command-handlers/autocompleteInteractionHandler.ts`

- Gestioneaza autocomplete pentru optiunile slash commands.
- Delegheaza scoring-ul, sortarea si limitarea optiunilor catre `buildAutocompleteChoices` (TS-primary — masurat mai rapid decat nativul pe marshaling, vezi `BENCHMARKS.md`).
- Trebuie tinut separat de logica de executie a comenzilor.

### `src/features/command-handlers/fallbackInteractionHandler.ts`

- Fallback de final pentru interactiuni necunoscute sau neacoperite.
- Nu trebuie sa redezvolte logica de comenzi deja extrasa.

## Notifications

### `src/features/notifications/index.ts`

- Instaleaza job-urile de notificari.
- Conecteaza serviciile de update-uri si reduceri la runtime.
- Trebuie sa ramana wiring, nu locul principal pentru logica de notificari.

### `src/features/notifications/updateNotificationService.ts`

- Proceseaza update-urile noi.
- Verifica deduplicarea prin repository.
- Construieste si trimite embed-uri de update.

### `src/features/notifications/discountNotificationService.ts`

- Proceseaza reducerile noi.
- Verifica deduplicarea prin repository.
- Foloseste `dealPassesFilters` pentru a respecta setarile guild-ului.

### `src/features/notifications/outboundChannel.ts`

- Rezolva canalul Discord in care se trimit notificarile.
- Izoleaza erorile de canal lipsa sau inaccesibil.

### `src/features/notifications/seenRepository.ts`

- Citeste si scrie elementele deja vazute.
- Acopera atat update-uri, cat si reduceri.
- Este modulul central pentru evitarea duplicatelor.

## Domain, scrapers si sources

### `src/domain/deals/filtersCore.ts`

- Expune filtre pentru deal-uri, normalizatoare pentru pending queues si helper-e Map/Object.
- Foloseste `dealPassesFilters` din `src/native/fuzzy.ts` (TS-primary — calcul trivial, nativul pierde pe overhead-ul apelului, vezi `BENCHMARKS.md`).

### `src/sources/sourceRegistry.ts`

- Agrega sursele externe.
- Gestioneaza fallback-uri si erori de schema prin modulele din `src/sources/`.
- Sursele Steam/deals/updates sunt incluse in strict TypeScript si au teste directe pentru shape drift.
- Contractul registrului e **value-tipat**: `SourceContext` si returul lui `buildSourceRegistry` sunt aliasul `SourceRegistryApi`, in care fiecare dintre cele 30 de chei are semnatura concreta (nu `unknown`); cele 4 exporturi named (`dealHash`, `safeCheerioLoad`, `extractOfferEndFromHtml`, `MAX_HTML_BYTES`) au tipuri precise. Vezi `CONTEXT_REPO_CLEAN.md` (Pasul 7) pentru constrangerea `export =` care tine intrarile/iesirile de domeniu pe `unknown`. Acoperit de `sourceRegistryTypedApi.test.ts`.

### `src/sources/updates/index.ts`

- Fetch-uieste update-uri din Steam, RSS, HTML listing si surse custom.
- Foloseste Rust pentru curatare text, scoring URL/listing si clasificare patch notes.

### `src/sources/deals/index.ts`

- Fetch-uieste reduceri Steam/Epic, deduplica si sorteaza ofertele.
- Foloseste `normalizeTitleForDedupe` si `dealHash` din Rust/N-API prin context.

### `src/sources/steam/index.ts`

- Cauta jocuri Steam, alege cel mai bun match si extrage detalii de pret.
- Foloseste Levenshtein din Rust/N-API.

## Native Rust/N-API

### `src/native/src/lib.rs`

- Contine functii deterministe si izolate: fuzzy matching, Levenshtein, normalizare text, hash-uri, autocomplete scoring, scoring listing-uri si filtrare deal-uri.
- Nu trebuie sa depinda de Discord, Mongo, HTTP, env sau filesystem.

### `src/native/fuzzy.ts`

- Incarca addon-ul `.node` si expune fallback TypeScript.
- Trebuie sa pastreze contract identic intre Rust si TypeScript.
- Logheaza explicit cand addon-ul nativ lipseste in productie.

## Test map

Teste de baza:

- env/config;
- registry si slash commands;
- parsere si filtre;
- circuit breaker si cooldown-uri;
- health/metrics;
- deduplicare;
- native Rust/fallback contracts.

Teste functionale curente:

- `simpleCommandsHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`.
- `sourceScraperShapeDrift.test.ts`.

Teste E2E:

- flux update: `/start updates` -> guild in Mongo -> cron gaseste update -> trimite embed -> marcheaza seen;
- flux reduceri: `/start reduceri` -> baseline reduceri -> cron -> deal embed -> `seenDiscounts`.

