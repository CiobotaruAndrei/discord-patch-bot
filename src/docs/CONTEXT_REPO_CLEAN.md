# Context repo curat

Documentul descrie starea curenta a repo-ului dupa migrarea treptata din fisiere mari legacy spre module organizate pe functionalitate.

## Starea curenta

- Codul principal este in `src/`.
- `src/package.json`, `src/package-lock.json`, `src/.env.example`, `src/tsconfig.json` si `src/tsconfig.strict.json` sunt fisierele active pentru build/test/runtime Node.
- Fisierele active sunt grupate pe functionalitati, nu duplicate la radacina.
- `src/features/command-router/` nu mai reprezinta arhitectura curenta.
- Comenzile cunoscute si autocomplete-ul sunt mutate in `src/features/command-handlers/`.
- `fallbackInteractionHandler.ts` este doar fallback de final pentru interactiuni necunoscute sau ramase neacoperite.
- `notifications/index.ts` este wiring pentru job-uri; logica de update-uri si reduceri este in servicii dedicate.
- Rust/N-API este folosit doar pentru hot-path-uri pure, cu fallback TypeScript in `src/native/fuzzy.ts`.
- Migrarea TypeScript strict este incrementala prin `src/tsconfig.strict.json`.
- `legacy-dynamic.d.ts` nu mai exista; tipurile dinamice trebuie modelate local.
- Documentatia istorica versionata a fost scoasa din cod; fisierele curente de documentatie raman sursa de adevar.
- Comentariile explicative din fisierele de cod au fost eliminate. Daca un rationale trebuie pastrat, el trebuie pus in documentatia potrivita dupa subiect, nu langa implementare.
- Codul runtime nu mai foloseste abrevierea legacy pentru context; modulele de compatibilitate folosesc `target` pentru atasare si `deps` pentru factory-uri.
- Testele din `src/test` nu mai folosesc abrevieri legacy de context sau tipuri wildcard nesigure; mock-urile Discord/Mongo/HTTP folosesc shape-uri locale si `unknown` pentru cazuri intentionat invalide.
- Helper-ele de test si variabilele de wiring trebuie numite explicit, de exemplu `makeContext`, `runtimeContext` si `validationContext`.

## Structura logica

```text
src/
  app/
    main.ts
    health/
    lifecycle/
    scheduler/
  config/
    configLoader.ts
    configValidator.ts
  domain/
    deals/
      filtersCore.ts
  features/
    command-cache/
    command-definitions/
    command-handlers/
      autocompleteInteractionHandler.ts
      dlcInteractionHandler.ts
      fallbackInteractionHandler.ts
      gameFilterHandlers.ts
      helpInteractionHandler.ts
      latestInteractionHandler.ts
      rolePingHandlers.ts
      setInteractionHandler.ts
      simpleCommandsHandler.ts
      statusInteractionHandler.ts
      subscriptionNotificationHandlers.ts
    command-presentation/
    command-registry/
    command-runtime/
    command-security/
    notifications/
      discountNotificationService.ts
      index.ts
      outboundChannel.ts
      seenRepository.ts
      updateNotificationService.ts
  infra/
    http/
    mongo/
  native/
    fuzzy.ts
    src/lib.rs
  shared/
  sources/
    deals/
    steam/
    updates/
    sourceRegistry.ts
  test/
```

## Comenzi si interactiuni

`interactions.ts` trebuie tratat ca strat de routing/wiring. Logica concreta sta in handler-e dedicate:

- `simpleCommandsHandler.ts` - comenzi simple precum ping/games;
- `helpInteractionHandler.ts` - paginare si continut pentru help;
- `subscriptionNotificationHandlers.ts` - start/stop pentru update-uri si reduceri;
- `gameFilterHandlers.ts` - filtre si validari pentru jocuri;
- `rolePingHandlers.ts` - roluri pentru ping-uri;
- `setInteractionHandler.ts` - subcomenzile `/set`;
- `latestInteractionHandler.ts` - `/latest`;
- `dlcInteractionHandler.ts` - `/dlc`;
- `statusInteractionHandler.ts` - `/status <joc>`;
- `autocompleteInteractionHandler.ts` - autocomplete pentru optiuni;
- `fallbackInteractionHandler.ts` - fallback de final.

Directia corecta este ca fiecare handler sa primeasca dependinte explicite si tipate, iar `interactions.ts` sa ramana cat mai subtire.

## Notificari

Zona de notificari este impartita astfel:

- `index.ts` instaleaza job-urile si conecteaza serviciile la runtime;
- `updateNotificationService.ts` construieste si trimite notificarile pentru update-uri;
- `discountNotificationService.ts` construieste si trimite notificarile pentru reduceri;
- `outboundChannel.ts` rezolva canalul Discord de trimitere;
- `seenRepository.ts` gestioneaza deduplicarea prin `seenUpdates` si `seenDiscounts`.

Aceasta impartire reduce riscul de copy-paste in cron jobs si permite teste functionale mai clare.

## Native Rust/N-API

`src/native/src/lib.rs` contine doar functii deterministe, fara Discord, Mongo sau HTTP:

- fuzzy matching si Levenshtein;
- normalizare text si titluri;
- `stableUpdateId`, `normalizeDealState` si `dealHash`;
- scoring pentru listing-uri si URL-uri Steam;
- `buildAutocompleteChoices` pentru scoring, sortare si limitare optiuni Discord;
- `chooseSteamMatchIndex` pentru alegerea determinista a rezultatului Steam folosit de `/latest pret` si `/dlc`;
- `dealPassesFilters` pentru filtrarea ofertelor in cron si `/latest reduceri`.

`src/native/fuzzy.ts` ramane adapterul TypeScript cu fallback. Daca addon-ul `.node` nu se incarca, botul continua pe fallback si logheaza explicit problema.

## TypeScript strict

`src/tsconfig.strict.json` include doar fisiere stabilizate. Nu activa brusc strict pe tot proiectul pana cand zonele cu context dinamic si API-uri Discord complexe nu sunt tipate suficient.

Zone deja potrivite pentru strict:

- filtre pure din `src/domain/deals/`;
- repository-ul de seen items;
- serviciile de notificari;
- handler-ele de comenzi extrase;
- utilitarele de health/metrics si config;
- adapterul `src/native/fuzzy.ts`;
- sursele `src/sources/steam`, `src/sources/deals` si `src/sources/updates`;
- testele functionale/E2E si testele directe de shape drift pentru scrapers.

Zone care inca trebuie urmarite:

- `commandRuntimeContext.ts`;
- `commandRegistry.ts`;
- adapterele care inca primesc un target comun mare, desi `commandCache`, `commandPresentation`, `notifications/index`, fallback-ul de interactiuni si `mongoContext` au deja factory-uri explicite;
- mock-urile de test trebuie mentinute pe shape-uri locale mici cand apar fluxuri noi pentru Discord, Mongo sau HTTP.

## Securitate si runtime

- Comenzile administrative trebuie sa aiba atat permisiuni declarate in slash command, cat si verificari runtime in handler.
- Linkurile externe si proxy-urile trebuie validate prin config, iar request-urile HTTP trec prin validare URL si DNS/IP ca protectie SSRF.
- `/metrics` trebuie protejat cu token cand este expus in afara mediului local.
- Token-urile Discord, URI-urile Mongo si webhook-urile nu trebuie comise.
- Docker trebuie sa ruleze procesul ca user non-root.

## Teste importante

Ruleaza din `src/`:

```bash
npm test
npm run test:functional
npm run test:e2e
npm run typecheck
npm run typecheck:strict
npm run build
```

Teste relevante pentru structura actuala:

- `simpleCommandsHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`;
- `sourceScraperShapeDrift.test.ts`;
- testele E2E pentru update-uri si reduceri.

## Zone ramase de curatat

- Reducerea contextului comun din runtime si registry.
- Mentinerea testelor fara tipuri wildcard nesigure sau abrevieri legacy de context cand se adauga mock-uri noi.
- Mutarea oricarei logici ramase in adaptere catre servicii sau handler-e dedicate.
- Mentinerea documentatiei sincronizate la fiecare schimbare de cod.
