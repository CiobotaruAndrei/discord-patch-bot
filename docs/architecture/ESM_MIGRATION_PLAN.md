# Plan de migrare CommonJS -> ESM (review impact-mare #4)

Acest document este runbook-ul autoritar pentru migrarea codebase-ului de la
CommonJS (`export =` / `require()`) la module ECMAScript. NU este o schimbare
care se poate face „per-feature" sub configul curent; procedura de mai jos e
verificata empiric printr-un dry-run pe o copie a intregului `src/`.

## De ce NU e per-feature

Proiectul compileaza cu un singur `tsconfig` (`module: "CommonJS"`,
`moduleResolution: "Node"`). Sub acest config `tsc` emite CJS pentru **toate**
fisierele — nu se poate emite ESM doar pentru `features/youtube/` in timp ce
restul ramane CJS. Singurul mecanism per-fisier (`.mts` sub `nodenext`) forteaza
un flip global de `moduleResolution` care la randul lui cere extensii `.js` pe
toate importurile deodata.

**Insa** exista o cale in doua faze, sigura, fiindca TypeScript accepta sintaxa
`import`/`export` standard chiar sub `module: "commonjs"` si emite interop-CJS.
Deci modernizarea de sintaxa se poate face si valida **verde** inainte de flip-ul
final de emit ESM.

## Starea masurata (dry-run, copie completa `src/`)

- **562** fisiere `.ts` first-party
- **145** `export =` (ilegal in ESM)
- **364** `require(...)`, dintre care majoritatea in idiomul de DI tipat
  `const { x } = require("S") as typeof import("S")` — pattern-ul central de
  compunere (`createMongoContext`, factory-urile `buildFrom`, context proaspat
  per registru se bazeaza pe semantica de load-time)
- **11** fisiere cu `__dirname`/`__filename`
- **33** aparitii `require.main` / `module.exports` / `require.resolve`
- **3** `require(...)` dinamice (path calculat) — inclusiv loader-ul nativ NAPI
- **0** `require("*.json")`

## Faza A — modernizare de sintaxa (CJS-verde, incrementala)

Codemod-ul din Anexa converteste mecanic idiomurile in sintaxa ESM standard.
Ruleaza sub `module: "commonjs"` neschimbat, deci se poate valida cu
`npm run check` la fiecare pas. Rezultatul dry-run pe intregul `src/`:

| Transformare | Aparitii auto-convertite |
| --- | --- |
| `const {..} = require(S) as typeof import(S)` -> `import {..} from S` | 135 |
| `const x = require(S) as typeof import(S)` -> `import x from S` | 160 |
| `import x = require(S)` -> `import x from S` | 75 |
| `export = <const-obiect shorthand>` -> `export { .. }` | 3 |
| `export = <ident/obiect>` -> `export default ..` | 64 |

Doar liniile la **coloana 0** (scope de modul) sunt atinse; `require`-urile lene
din interiorul functiilor (indentate) NU se ridica la top-level (ar schimba
semantica). Line-ending-urile fiecarui fisier se pastreaza.

### Reziduu manual dupa pasul mecanic

Dupa codemod, `tsc --noEmit` (tot pe `module: commonjs`) raporteaza **104**
erori, concentrate si categorisite:

- **`export =` de obiect/installer convertit gresit la `export default`**
  (`TS1192` no default export × 19, `TS2614` no exported member × 9,
  `TS2339` × 39). Modulele care sunt un **obiect de exporturi** sau un
  **callable-cu-proprietati** (`Object.assign(attachFn, exportsObj); export = attachFn`)
  nu se pot reprezenta printr-un simplu `export default`, fiindca consumatorii fac
  `const { a } = require(M)`. Fix: aceste module primesc **named exports**
  (obiect) sau `export default <callable>` **plus** `export { ...props }`
  (installer), iar consumatorii trec pe `import { a } from M`.

  Module de tratat manual (installer + obiect-export), din dry-run:
  `domain/deals/filters.ts`, `features/command-security/adminPermissionGuard.ts`,
  `infra/mongo/adminAlerts.ts`, `infra/mongo/fetchSnapshots.ts`,
  `infra/mongo/guildSettings.ts`, `infra/mongo/locks.ts`,
  `infra/mongo/migrations.ts`, `infra/mongo/sourceHealth.ts`,
  `infra/mongo/systemState.ts`, `shared/domain.ts`, `shared/env.ts`,
  `shared/logging.ts`, `shared/utilities.ts`, plus modulele-obiect
  `infra/mongo/mongoContext.ts`, `features/command-cache/commandCache.ts`,
  `features/notifications/index.ts`, `features/notifications/historyRepository.ts`,
  `infra/mongo/adminAlertContent.ts`, `infra/redis/redis*.ts`,
  `app/lifecycle/guildOnboarding.ts`.

- **Interop discord.js / namespace** (`TS2497`, `TS2322`): ex. `GatewayIntentBits`
  din `import { Client, GatewayIntentBits } from "discord.js"` — se rezolva cu
  `import * as Discord` sau referire prin default, plus `esModuleInterop`
  (deja activ). Manual, punctual.

- **`any` implicit (`TS7006` × 20)**: parametri de callback care isi pierd
  inferenta cand importul devine default (ex. `game`). Fix: tip explicit.

- **Nuante de tip la margine (`TS2345` × 13, `TS2353`)**: `DiscordInteraction`
  cu `options` partiale — se aliniaza tipurile de margine.

## Faza B — cutover de emit ESM (big-bang, in fereastra fara churn)

Se ruleaza intr-un singur pas, cand `main` nu are PR-uri concurente in zbor
(altfel rescrie ~tot arborele si intra in coliziune — vezi regulile 12–13):

1. `tsconfig.json`: `module: "NodeNext"`, `moduleResolution: "NodeNext"`,
   scoate `esModuleInterop` daca nu mai e necesar (verbatim).
2. `package.json`: adauga `"type": "module"`.
3. **Extensii `.js`** pe toate importurile relative (`from "./x"` -> `from "./x.js"`,
   barrel-urile `./dir` -> `./dir/index.js`). Scriptabil, dar obligatoriu global
   sub NodeNext.
4. **`__dirname`/`__filename`** (11 fisiere): `const __dirname = path.dirname(fileURLToPath(import.meta.url));`
5. **Loader nativ NAPI** (`fuzzyNativeBridge.ts` + cele 3 `require` dinamice):
   `import { createRequire } from "node:module"; const require = createRequire(import.meta.url);`
   `.node` nu se poate `import` direct in ESM.
6. **`module.exports` / `require.main` / `require.resolve`** (33): echivalente ESM
   (`import.meta.url === ...`, `import.meta.resolve`).
7. **Runner de teste**: `node --test` cu globuri **in ghilimele**
   (`"dist/test/**/*.test.js"`) ca node sa expandeze (pe Linux CI `**` fara
   `globstar` colapseaza la un nivel — vezi si #12).

## Verificare

- Faza A: `npm run check` verde dupa fiecare cluster (module + consumatorii lor,
  convertiti impreuna — altfel `require(M)` pe un modul deja `export default` se
  rupe la interop).
- Faza B: `npm run check:full` (check + native + e2e) + smoke live pe staging;
  boot real (`node dist/app/main.js`) ca sa validezi loader-ul nativ si
  `import.meta` la runtime, nu doar tipuri.

## Rollback

Migrarea sta pe un branch dedicat. Daca `check:full` sau smoke-ul pica, se
revine la commit-ul de dinainte de flip (Faza B e un singur commit reversibil).
Faza A e CJS-compatibila, deci poate ramane mergeuita independent chiar daca
Faza B se amana.

## Anexa — codemod-ul de Faza A

Scriptul de mai jos e cel rulat in dry-run. Se pastreaza aici (nu ca tooling
compilat in `src/`, ca sa nu intre sub gate-urile de no-comments/weakening) si se
ruleaza `node esm-codemod.mjs src` in fereastra de executie.

```js
// Converteste export= / require() la sintaxa import/export (CJS-verde).
// Doar liniile la coloana 0 (scope de modul); pastreaza line-ending-urile.
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const RE = {
  reqNamedTyped: /^const (\{[^}]*\}) = require\((["'][^"']+["'])\) as typeof import\(["'][^"']+["']\);$/,
  reqDefTyped:   /^const ([A-Za-z_$][\w$]*) = require\((["'][^"']+["'])\) as typeof import\(["'][^"']+["']\);$/,
  reqNamed:      /^const (\{[^}]*\}) = require\((["'][^"']+["'])\);$/,
  reqDef:        /^const ([A-Za-z_$][\w$]*) = require\((["'][^"']+["'])\);$/,
  importEquals:  /^import ([A-Za-z_$][\w$]*) = require\((["'][^"']+["'])\);$/,
  exportIdent:   /^export = ([A-Za-z_$][\w$]*);$/
};
// (implementare completa: convert linii, deriva named-export din const-obiect
//  shorthand cand e sigur, altfel export default + flag installer pentru manual)
```

Loghează `installer-residue.txt` cu modulele callable-cu-proprietati care cer
conversie manuala (vezi lista din sectiunea de reziduu).
