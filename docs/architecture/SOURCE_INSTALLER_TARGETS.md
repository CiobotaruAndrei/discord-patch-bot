# Contractele familiilor de surse

Familiile de surse (`steam`, `updates`, `deals`) nu mai au target de installer. Modelul cu context progresiv
(`SomeDeps & Partial<SomeApi>`) a fost eliminat: era mai bun decat un bag `Record<string, unknown>`, dar tot
lasa fiecare export optional pana la runtime, deci o dependinta uitata pica la boot, nu la compilare.

Modelul curent este o fabrica per familie, cu contract propriu de intrare si de iesire:

```ts
function createSteamSource(deps: SteamSourceDeps): SteamSourceApi;
function createUpdates(d: UpdatesDeps): UpdatesApi;
function createDeals(d: DealsDeps): DealsApi;
```

Trei consecinte practice:

- **Completitudinea e dovedita la compilare.** Tipul de retur e API-ul intreg, nu `Partial<...>`, deci un export
  lipsa e eroare de `tsc`, nu `undefined` gasit in productie.
- **Nu mai exista `buildFrom` in cele trei familii.** `createSourceRegistry` le apeleaza direct, cu obiecte
  literale in care fiecare dependinta e enumerata. Singurul `buildFrom` ramas pe calea surselor este cel al
  clientului HTTP (`infra/http/client.ts`), fiindca acela chiar contribuie la contextul comun.
- **`createUpdates` si `createDeals` isi fac snapshot pe deps** (`const deps = { ...d };`), deci o mutatie tarzie
  a obiectului apelantului nu se scurge in fabrica dupa constructie.

Guard-ul `sourceInstallerTargetContracts.test.ts` blocheaza revenirea la `Deps & Record<string, unknown>`, la
`Partial<*Api>` si la wrapper-ele `buildFrom` din aceste trei module.
