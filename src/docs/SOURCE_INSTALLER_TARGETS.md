# Source Installer Targets

Modulele de surse care expun deja un API tipat trebuie sa foloseasca API-ul respectiv in target-ul installer-ului, nu un bag generic.

Modelul acceptat:

```ts
type SomeContext = SomeDeps & Partial<SomeApi>;
```

`SomeDeps` descrie dependintele necesare pentru factory, iar `Partial<SomeApi>` descrie exporturile pe care installer-ul le adauga progresiv in registry. Asta pastreaza wiring-ul incremental, dar TypeScript vede explicit ce API poate ajunge pe target.

Starea curenta:

- `sources/deals` foloseste `DealsDeps & Partial<DealsApi>`.
- `sources/updates` foloseste `UpdatesDeps & Partial<UpdatesApi>`.

Guard-ul `sourceInstallerTargetContracts.test.ts` blocheaza revenirea acestor module la `Deps & Record<string, unknown>`.
