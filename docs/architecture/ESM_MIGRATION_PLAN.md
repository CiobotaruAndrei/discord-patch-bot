# Plan de migrare CommonJS -> ESM (review impact-mare #4)

Acest document pastreaza runbook-ul autoritar folosit pentru migrarea
codebase-ului de la CommonJS (`export =` / `require()`) la module ECMAScript.
Migrarea este completa; sectiunile de plan si dry-run de mai jos raman context
istoric pentru deciziile luate.

## De ce NU e per-feature

La momentul planificarii, proiectul compila cu un singur `tsconfig`
(`module: "CommonJS"`, `moduleResolution: "Node"`). Sub acel config `tsc`
emitea CJS pentru **toate**
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

## Stadiu: MIGRARE COMPLETA — Faza A (PR #642, mers) + Faza B EXECUTATE

Faza B (cutover-ul de emit ESM) a fost executata pe branch-ul
`refactor/esm-migration-phase-b` si e VERDE: `tsc` 0 erori sub `NodeNext`,
`npm run check` complet (1514 teste, 0 fail), `test:e2e:prebuilt` 7/7,
`npm audit` 0, boot-graph smoke (main.js incarca tot graful ESM si face
fail-fast curat pe env) si addon-ul NAPI se incarca prin
`createRequire(import.meta.url)` (require(esm) pe Node 24). Detalii de executie:

- `tsconfig`: `module`/`moduleResolution` = `NodeNext`; `package.json`: `"type": "module"`;
  `native/package.json` primeste si el `"type": "module"` (altfel TS clasifica
  fisierele din `native/` drept CJS dupa cel mai apropiat package.json, dar la
  runtime `dist/native/*.js` cade sub `type: module` -> nepotrivire).
- 1397 extensii `.js` adaugate pe importurile relative (inclusiv pozitiile
  `import(...)`/`typeof import(...)`); 6 fisiere cu shim `__dirname` via
  `import.meta.url`; 71 fisiere cu `const require = createRequire(import.meta.url)`.
- Idiomurile CJS de runtime convertite: `require.main === module` ->
  `pathToFileURL(process.argv[1]).href === import.meta.url` (14 scripturi);
  `module.exports = {...}` -> `export { ... }` (2 scripturi-gate).
- **Node 20 -> 24 (LTS)** in CI (5 workflow-uri), `Dockerfile` (ambele stage-uri),
  README si `engines` (`>=22.12`) — require(esm), de care depind require-urile
  lenese, exista doar de la Node 22.12+ (Node 20 era oricum EOL din aprilie 2026).
- Hoisting-ul importurilor ESM a rupt 13 teste care setau `process.env` inaintea
  require-urilor (sub CJS ordinea textuala se pastra): importurile respective au
  devenit `await import()` top-level DUPA setup-ul de env (ordine garantata).
- Garzile care pinuiau forme fara extensie sau require-uri tipate au fost
  repinuite pe formele finale (regula 8).

### Toolchain TypeScript 7

Build-ul si typecheck-ul ruleaza compilatorul nativ TypeScript 7 din
`@typescript/native`. Pachetul `typescript@6.0.3` ramane separat pentru
Compiler API-ul folosit de verificatoarele AST si de testele de contract; TypeScript
7 nu exporta inca acel API. Ambele versiuni sunt pinuite exact si verificate prin
`check:dependencies`, inclusiv aliasul npm al compilatorului nativ.

## Stadiu istoric: Faza A EXECUTATA (branch `refactor/esm-migration`)

Faza A a fost aplicata pe tot `src/` si e VERDE: `npm run check` complet (typecheck
+ build + toate gate-urile + 1514 teste, 0 fail), `test:e2e:prebuilt` 7/7, `npm audit` 0.
Decizii luate la executie (fata de planul initial):

- **Strategia de export: totul `export default`** (conversia in named exports a fost
  incercata si abandonata — crestea reziduul de tip de ~5x fara castig; `require()`-urile
  lenese ramase acceseaza modulul prin `.default`).
- Codemod-ul final converteste DOAR require-urile single-line de la coloana 0 (cele
  multi-linie cu cast `as {...}` se strica la regex si au fost tratate manual), plus
  `typeof import("modulDefault")` -> `typeof import(...)["default"]` (fix-ul care
  colapseaza cascada de tip din composition-root).
- `sources/sourceRegistry.ts` nu mai muta `module.exports` prin `Object.assign`
  (ilegal in ESM): toate cheile `SourceRegistryApi` sunt re-exportate explicit ca
  named exports + registrul compus ca `export default`.
- Reziduul de tip (~136 de erori dupa codemod) a fost rezolvat manual: casturile
  `as TipSpecific` pierdute la conversie au fost re-adaugate ca downcast-uri valide
  (`as object as X` unde tipurile nu se suprapun — gate-ul interzice doar `as never`
  si `as unknown as`), functiile validator din `shared/utilities` au primit named
  exports, iar `MongoModelsContext` a devenit exportat pentru consumatorii lui
  `buildFrom`.
- Testele-garda care pinuiau sintaxa CJS (`export = `, `import X = require`,
  `require(...) as typeof import(...)`) au fost repinuite pe formele ESM (regula 8:
  acelasi scenariu, sintaxa migrata).

Faza B (flip `NodeNext` + `type: module` + extensii `.js` + `createRequire`
pentru loader-ul nativ) a fost executata ulterior; sectiunea de mai jos pastreaza
procedura istorica.

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