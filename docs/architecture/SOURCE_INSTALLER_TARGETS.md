# Source Installer Targets

Modulele de surse care expun deja un API tipat trebuie sa foloseasca API-ul respectiv in target-ul installer-ului, nu un bag generic.

Modelul acceptat:

```ts
type SomeContext = SomeDeps;
```

`SomeDeps` descrie singurele dependinte necesare pentru factory. Contributia returnata de factory este compusa prin spread intr-un obiect nou; target-ul nu mai mosteneste API-ul partial al etapelor precedente.

Starea curenta:

- `sources/deals` foloseste `DealsDeps`.
- `sources/updates` foloseste `UpdatesDeps`.

Guard-ul `sourceInstallerTargetContracts.test.ts` blocheaza revenirea acestor module la `Deps & Record<string, unknown>`.
