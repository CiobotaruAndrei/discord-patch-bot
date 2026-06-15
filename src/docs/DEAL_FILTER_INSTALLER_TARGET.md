# Deal Filter Installer Target

Installer-ul `domain/deals/filters` expune doar functiile pure din `filtersCore`, deci target-ul progresiv trebuie sa fie derivat direct din exporturile reale ale modulului:

```ts
type DealFiltersContext = Partial<typeof dealFilterExports>;
```

Acest contract pastreaza compatibilitatea cu registry-ul incremental, dar elimina bag-ul generic `Record<string, unknown>` dintr-un installer care nu are nevoie de chei dinamice.

Guard-ul `dealFilterInstallerTargetContracts.test.ts` blocheaza revenirea la target generic.
