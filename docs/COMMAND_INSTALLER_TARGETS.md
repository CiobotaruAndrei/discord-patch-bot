# Command Installer Targets

Modulele de command wiring care au deja factory explicit trebuie sa deriveze tipul target-ului de installer din runtime-ul produs de factory, nu dintr-un bag generic.

Modelul acceptat:

```ts
type SomeRuntime = ReturnType<typeof createSomeModule>;
type SomeContext = SomeDeps & Partial<SomeRuntime>;
```

Motivul: installer-ul primeste dependintele reale de care are nevoie si poate adauga exporturile produse de factory, fara sa declare ca accepta orice cheie prin `Record<string, unknown>`. Asta pastreaza compatibilitatea cu registrul progresiv, dar reduce suprafata legacy controlata doar la runtime.

Starea curenta:

- `commandCache` foloseste `CommandCacheRuntime = ReturnType<typeof createCommandCache>`.
- `commandPresentation` foloseste `CommandUiRuntime = ReturnType<typeof createCommandPresentation>`.

Guard-ul `commandInstallerTargetContracts.test.ts` blocheaza revenirea acestor doua module la `Deps & Record<string, unknown>`.
