# File rename map

Repo-ul de pe `main` foloseste deja nume descriptive pentru agregatoarele care erau doar fisiere `index.ts`. Harta de mai jos noteaza redenumirile active si importurile care trebuie pastrate asa.

## Redenumiri facute

- `src/infra/mongo/index.ts` -> `src/infra/mongo/mongoContext.ts`: construieste si exporta contextul comun Mongo + shared utilities.
- `src/sources/index.ts` -> `src/sources/sourceRegistry.ts`: ataseaza HTTP, Steam, update sources si deals sources pe contextul scraperelor.
- `src/features/commands/index.ts` -> `src/features/commands/commandRegistry.ts`: ataseaza cache, filtre, UI, notificari, slash commands si interactions pe contextul comenzilor.

## Importuri actualizate

- `src/app/main.ts` foloseste `mongoContext`, `commandRegistry` si `sourceRegistry` direct.
- `src/features/commands/runtime.ts` si `src/sources/runtime.ts` folosesc noile nume, ca sa nu mai depinda de importuri implicite pe folder.
- Testele care foloseau agregatoarele importa fisierele cu nume explicit.

## Ce ramane intentionat

Fisierele `src/sources/steam/index.ts`, `src/sources/deals/index.ts`, `src/sources/updates/index.ts` si `src/features/notifications/index.ts` raman inca fisiere mari de implementare. Ele nu sunt simple re-exporturi; contin logica efectiva a modulelor respective.

Daca se cere zero fisiere `index.ts` peste tot, urmatorul pas sigur este mutarea lor pe rand in `steamSource.ts`, `dealSources.ts`, `updateSources.ts` si `notificationWorkflows.ts`, cu aceleasi teste dupa fiecare mutare.
