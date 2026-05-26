# Context repo curat

Documentul descrie starea curenta a repo-ului dupa migrarea treptata din fisiere mari legacy spre module organizate pe functionalitate.

## Starea curenta

- Codul principal este in `src/`.
- Fisierele active sunt grupate pe functionalitati, nu duplicate la radacina.
- `src/features/command-router/` nu mai reprezinta arhitectura curenta.
- Comenzile cunoscute si autocomplete-ul sunt mutate in `src/features/command-handlers/`.
- `fallbackInteractionHandler.ts` este doar fallback de final pentru interactiuni necunoscute sau ramase neacoperite.
- `notifications/index.ts` este wiring pentru job-uri; logica de update-uri si reduceri este in servicii dedicate.
- Migrarea TypeScript strict este incrementala prin `src/tsconfig.strict.json`.

## Structura logica

```text
src/
  app/
    main.ts
    health/httpServer.ts
  config/
    env.ts
    runtime.ts
  db/
    mongo.ts
    models.ts
  features/
    commands/
      commandRegistry.ts
      commandRuntimeContext.ts
      slashCommands.ts
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
    notifications/
      discountNotificationService.ts
      index.ts
      outboundChannel.ts
      seenRepository.ts
      updateNotificationService.ts
    scrapers/
      filtersCore.ts
      ...
    sources/
      sourceRegistry.ts
      ...
  jobs/
    ...
  lib/
    ...
  docs/
    CONTEXT_REPO_CLEAN.md
    FUNCTION_MAP_CLEAN.md
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
- `statusInteractionHandler.ts` - `/status`;
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

## TypeScript strict

`src/tsconfig.strict.json` include doar fisiere stabilizate. Nu activa brusc strict pe tot proiectul pana cand zonele cu context dinamic si API-uri Discord complexe nu sunt tipate suficient.

Zone deja potrivite pentru strict:

- filtre pure din scraping;
- repository-ul de seen items;
- serviciile de notificari;
- handler-ele de comenzi extrase;
- utilitarele de health/metrics si config.

Zone care inca trebuie urmarite:

- `commandRuntimeContext.ts`;
- `commandRegistry.ts`;
- adapterele care inca primesc un context comun mare;
- locurile unde apar `any` pentru builder-e sau interactiuni Discord.js.

## Securitate si runtime

- Comenzile administrative trebuie sa aiba atat permisiuni declarate in slash command, cat si verificari runtime in handler.
- Linkurile externe si proxy-urile trebuie validate prin config.
- `/metrics` trebuie protejat cu token cand este expus in afara mediului local.
- Token-urile Discord, URI-urile Mongo si webhook-urile nu trebuie comise.
- Docker trebuie sa ruleze procesul ca user non-root.

## Teste importante

Ruleaza cel putin:

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
- testele E2E pentru update-uri si reduceri.

## Zone ramase de curatat

- Reducerea contextului comun din runtime si registry.
- Tiparea builder-elor Discord unde apar inca `any`.
- Mutarea oricarei logici ramase in adaptere catre servicii sau handler-e dedicate.
- Mentinerea documentatiei sincronizate la fiecare schimbare de cod.
