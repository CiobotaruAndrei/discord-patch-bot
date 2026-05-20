# File rename map

Redenumirile din branch-ul acesta curata fisierele `index.ts` care erau doar puncte de agregare. Numele noi descriu rolul fisierului, iar importurile au fost mutate explicit catre ele.

## Redenumiri facute

- `src/infra/mongo/index.ts` -> `src/infra/mongo/mongoContext.ts`: construieste si exporta contextul comun Mongo + shared utilities.
- `src/sources/index.ts` -> `src/sources/sourceRegistry.ts`: ataseaza HTTP, Steam, update sources si deals sources pe contextul scraperelor.
- `src/features/commands/index.ts` -> `src/features/commands/commandRegistry.ts`: ataseaza cache, filtre, UI, notificari, slash commands si interactions pe contextul comenzilor.

## Importuri actualizate

- `src/app/main.ts` foloseste acum `mongoContext`, `commandRegistry` si `sourceRegistry` direct.
- `src/features/commands/runtime.ts` si `src/sources/runtime.ts` folosesc noile nume, ca sa nu mai depinda de importuri implicite pe folder.
- Testele care foloseau agregatoarele importa acum fisierele cu nume explicit.

## Ce ramane neschimbat

Fisierele mari de implementare din `src/sources/steam/index.ts`, `src/sources/deals/index.ts`, `src/sources/updates/index.ts` si `src/features/notifications/index.ts` raman neschimbate in acest pas. Ele contin logica efectiva a modulelor respective, nu doar re-exporturi mici. Daca vrei zero fisiere `index.ts` peste tot, urmatorul pas sigur este mutarea lor pe rand in `steamSource.ts`, `dealSources.ts`, `updateSources.ts` si `notificationWorkflows.ts`, cu aceleasi teste dupa fiecare mutare.
