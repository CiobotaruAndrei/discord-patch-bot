# Command Installer Targets

Modulele de command wiring care au deja factory explicit trebuie sa deriveze tipul target-ului de installer din runtime-ul produs de factory, nu dintr-un bag generic.

Modelul acceptat:

```ts
type SomeRuntime = ReturnType<typeof createSomeModule>;
type SomeContext = SomeDeps & Partial<SomeRuntime>;
```

Motivul: installer-ul primeste dependintele reale de care are nevoie si poate adauga exporturile produse de factory, fara sa declare ca accepta orice cheie prin `Record<string, unknown>`. Asta pastreaza compatibilitatea cu registrul progresiv, dar reduce suprafata legacy controlata doar la runtime.

Starea curenta:

- `commandPresentation` foloseste `CommandUiRuntime = ReturnType<typeof createCommandPresentation>`, deci inca are
  target derivat din runtime.
- `commandCache` a trecut mai departe si e **factory-only**: nu mai are installer si nici target, exporta doar
  `createCommandCache` plus helper-ele pure, iar `commandRegistry` il compune prin valoarea returnata. La fel
  `features/notifications/index` (`createNotificationRuntime`) si `infra/mongo/models` (`buildFrom`).

Cu alte cuvinte, target-ul derivat din runtime e treapta intermediara, nu destinatia: modulele care au putut
renunta complet la atasare au facut-o, iar `commandPresentation` e singurul care o mai foloseste.

Guard-ul `commandInstallerTargetContracts.test.ts` blocheaza si revenirea la `Deps & Record<string, unknown>`, si
reaparitia unui installer care muta `target` in modulele trecute pe factory-only.
