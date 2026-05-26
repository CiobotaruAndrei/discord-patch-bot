# Function map curat

Harta responsabilitatilor pentru structura curenta a proiectului. Foloseste acest fisier cand muti cod, redenumesti fisiere sau verifici daca documentatia mai corespunde cu repo-ul.

## App

### `src/app/main.ts`

- Porneste aplicatia.
- Incarca env/config.
- Conecteaza MongoDB.
- Creeaza clientul Discord.
- Instaleaza registrul de comenzi, interactiunile, job-urile si serverul health/metrics.

### `src/app/health/httpServer.ts`

- Expune `/healthz`.
- Expune `/metrics`.
- Protejeaza metrics cu token optional si comparatie sigura.
- Nu trebuie sa contina logica de business pentru Discord sau scraping.

## Config

### `src/config/env.ts`

- Citeste si valideaza variabilele de mediu.
- Centralizeaza valorile default.
- Nu trebuie sa expuna secrete in log-uri.

### `src/config/runtime.ts`

- Agrega setarile runtime folosite de bootstrap si job-uri.

## Database

### `src/db/mongo.ts`

- Gestioneaza conexiunea MongoDB.

### `src/db/models.ts`

- Defineste modelele Mongoose pentru guild-uri, jocuri si elemente deja vazute.

## Commands

### `src/features/commands/slashCommands.ts`

- Defineste structura slash commands pentru Discord.
- Seteaza permisiunile declarative pentru comenzile administrative.
- Trebuie sa ramana declarativ, fara logica de executie.

### `src/features/commands/commandRegistry.ts`

- Instaleaza modulele de comenzi si interactiuni.
- Leaga handler-ele la contextul runtime.
- Valideaza ca functiile necesare exista.
- Ramane o zona de tranzitie pana cand toate dependintele sunt injectate explicit.

### `src/features/commands/commandRuntimeContext.ts`

- Construieste contextul comun folosit de wiring.
- Este una dintre zonele principale de redus treptat.
- Scopul pe termen lung este sa livreze dependinte mici si tipate catre factory-uri, nu un `ctx` mare.

## Command handlers

### `src/features/command-handlers/simpleCommandsHandler.ts`

- Gestioneaza comenzi simple precum `/ping` si informatii de baza despre jocuri.
- Este o zona buna pentru strict typing deoarece are dependinte putine.

### `src/features/command-handlers/helpInteractionHandler.ts`

- Gestioneaza `/help` si paginarea help-ului.
- Trebuie sa ramana responsabil doar pentru UI-ul de help.

### `src/features/command-handlers/subscriptionNotificationHandlers.ts`

- Gestioneaza `/start` si `/stop` pentru update-uri si reduceri.
- Actualizeaza configuratia guild-ului si canalele de notificare.

### `src/features/command-handlers/gameFilterHandlers.ts`

- Gestioneaza filtrele de jocuri.
- Normalizeaza si valideaza input-ul pentru jocuri urmarite.

### `src/features/command-handlers/rolePingHandlers.ts`

- Gestioneaza rolurile folosite pentru ping-uri in notificari.

### `src/features/command-handlers/setInteractionHandler.ts`

- Gestioneaza subcomenzile `/set`.
- Trebuie sa aiba verificari runtime pentru administrator in operatiile sensibile.

### `src/features/command-handlers/latestInteractionHandler.ts`

- Gestioneaza `/latest`.
- Citeste ultimele update-uri cunoscute si raspunde cu embed-uri sau mesaje paginate.

### `src/features/command-handlers/dlcInteractionHandler.ts`

- Gestioneaza `/dlc`.
- Construieste raspunsuri pentru DLC-uri cunoscute.

### `src/features/command-handlers/statusInteractionHandler.ts`

- Gestioneaza `/status`.
- Afiseaza starea guild-ului, jocurile urmarite si setarile relevante.

### `src/features/command-handlers/autocompleteInteractionHandler.ts`

- Gestioneaza autocomplete pentru optiunile slash commands.
- Trebuie tinut separat de logica de executie a comenzilor.

### `src/features/command-handlers/fallbackInteractionHandler.ts`

- Fallback de final pentru interactiuni necunoscute sau neacoperite.
- Nu trebuie sa redezvolte logica de comenzi deja extrasa.
- Daca adaugi o comanda noua, creeaza handler dedicat si lasa fallback-ul minim.

## Interactions

### `src/interactions.ts`

- Router/wiring pentru interactiuni Discord.
- Delegarea catre handler-e trebuie sa fie explicita.
- Nu trebuie sa creasca inapoi intr-un fisier mare cu logica pentru toate comenzile.

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
- Construieste si trimite embed-uri de reduceri.

### `src/features/notifications/outboundChannel.ts`

- Rezolva canalul Discord in care se trimit notificarile.
- Izoleaza erorile de canal lipsa sau inaccesibil.

### `src/features/notifications/seenRepository.ts`

- Citeste si scrie elementele deja vazute.
- Acopera atat update-uri, cat si reduceri.
- Este modulul central pentru evitarea duplicatelor.

## Scrapers si sources

### `src/features/scrapers/filtersCore.ts`

- Contine functii pure pentru filtrare, normalizare si rotire de rezultate.
- Este tipat explicit si inclus in strict config.

### `src/features/sources/sourceRegistry.ts`

- Agrega sursele externe.
- Gestioneaza fallback-uri si erori de schema.
- Ramane o zona importanta pentru defensive coding deoarece HTML-ul extern se poate schimba.

## Jobs

- Job-urile cron trebuie sa orchestreze servicii, nu sa contina toata logica.
- Lock-urile, cooldown-urile si circuit breaker-ele trebuie sa previna rulari duplicate sau spam.

## Native Rust/N-API

- Codul din `src/native/` este optional si trebuie folosit doar pentru zone hot-path unde Rust aduce beneficii reale.
- Fallback-ul TypeScript trebuie sa ramana disponibil pentru medii fara build native.

## Test map

Teste de baza:

- env/config;
- registry si slash commands;
- parsere si filtre;
- circuit breaker si cooldown-uri;
- health/metrics;
- deduplicare.

Teste functionale curente:

- `simpleCommandsHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`.

Teste E2E:

- flux update: `/start updates` -> guild in Mongo -> cron gaseste update -> trimite embed -> marcheaza seen;
- flux reduceri: `/start reduceri` -> baseline reduceri -> cron -> deal embed -> `seenDiscounts`.

## Reguli de mentenanta

- Cand muti cod dintr-un fisier mare, creeaza handler/serviciu numit dupa functionalitate.
- Cand modifici logica, actualizeaza README, changelog si fisierele din `src/docs/` daca responsabilitatile s-au schimbat.
- Nu reintroduce fisiere duplicate la radacina proiectului.
- Nu transforma fallback-ul intr-un router mare.
- Nu activa strict global brusc; extinde `src/tsconfig.strict.json` pe module stabilizate.
