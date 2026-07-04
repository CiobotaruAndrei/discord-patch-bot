# File rename map

Repo-ul de pe `main` foloseste deja nume descriptive pentru agregatoarele care erau doar fisiere `index.ts`. Harta de mai jos noteaza redenumirile active si importurile care trebuie pastrate asa.

## Redenumiri facute

- `src/infra/mongo/index.ts` -> `src/infra/mongo/mongoContext.ts`: construieste si exporta contextul comun Mongo + shared utilities.
- `src/sources/index.ts` -> `src/sources/sourceRegistry.ts`: ataseaza HTTP, Steam, update sources si deals sources pe contextul scraperelor.
- `src/features/commands/index.ts` -> `src/features/command-registry/commandRegistry.ts`: ataseaza modulele de comenzi pe contextul runtime.

## Importuri actualizate

- `src/app/main.ts` foloseste `mongoContext`, `commandRegistry` si `sourceRegistry` direct.
- `src/features/command-runtime/commandRuntimeContext.ts` si `src/sources/runtime.ts` folosesc noile nume, ca sa nu mai depinda de importuri implicite pe folder.
- Testele care foloseau agregatoarele importa fisierele cu nume explicit.

## Ce ramane intentionat

Fisierele `src/sources/steam/index.ts`, `src/sources/deals/index.ts` si `src/sources/updates/index.ts` raman inca fisiere mari de implementare. Ele nu sunt simple re-exporturi; contin logica efectiva a modulelor respective.

`src/features/notifications/index.ts` nu mai este in aceeasi categorie: acum este strat de wiring, iar logica pentru update-uri si reduceri este in `updateNotificationService.ts` si `discountNotificationService.ts`.

Daca se cere zero fisiere `index.ts` peste tot, urmatorul pas sigur este mutarea lor pe rand in `steamSource.ts`, `dealSources.ts` si `updateSources.ts`, cu aceleasi teste dupa fiecare mutare.
