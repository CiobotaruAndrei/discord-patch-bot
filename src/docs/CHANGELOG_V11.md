# V11 - schimbari utile portate

Acest document noteaza ce a fost pastrat din fisierele locale si cum a fost organizat repo-ul dupa curatare, migrarea la TypeScript si introducerea graduala a Rust.

## Bug fix-uri si imbunatatiri portate

- `METRICS_TOKEN` placeholder este tratat ca lipsa, ca sa nu para production-safe din greseala.
- `safeCheerioLoad` taie HTML-ul mare pe limita de bytes fara sa rupa caractere UTF-8.
- `dealHash` nu mai include textul volatil al datei de expirare.
- `extractOfferEndFromHtml(html)` parseaza mai robust textele Steam pentru finalul ofertelor.
- `getLatestForAllGames` foloseste cache key bazat pe lista efectiva de jocuri.
- `buildOptimizedGameList(allGames, subscribedGuilds)` evita scraping-ul jocurilor nefolosite.
- `findGameAndSuggestion` foloseste cache LRU pentru autocomplete si fuzzy matching.
- HTTP foloseste agenti keep-alive, retry/backoff, proxy fallback si abort signal.
- Claim-urile atomice Mongo pentru update-uri si reduceri folosesc `withMongoRetry`.
- Cron-ul are lock distribuit, heartbeat, health window si backoff global.
- Erorile Discord permanente `10003`, `10004`, `50001`, `50013` dezactiveaza canalul afectat.
- A fost adaugat sistem de migrari DB la pornire.
- A fost adaugata schema JSON pentru `config.json`.
- Testele de regresie acopera zonele sensibile portate.

## Bug fix-uri gasite la recitire

- `runCronCycle` prinde acum erorile aruncate de `acquireDbLock` si programeaza urmatorul ciclu.
- Eroarea de lock intra in `cronErrors`, health window si alerta `cron:lock`.
- `createRateLimiter` citeste `x-forwarded-for` si cand Node il primeste ca array.
- Conversia `interactions.ts` a prins un bug real: `/status` folosea `fetchGameStatus` fara sa fie disponibil in scope. `src/features/commands/index.ts` il expune temporar prin `globalThis` pentru codul legacy convertit.
- Testele de regresie verifica protectiile pentru lock, abort signal, health, notificari, cache si surse.

## Bug fix-uri gasite la al doilea audit

- `handleDlcInteraction` nu mai testeaza `htmlRes.request?.path?.includes("agecheck")`: in axios `request.path` este path-ul initial, nu cel final dupa redirect, deci conditia nu firea niciodata. Detectia age-gate se bazeaza acum doar pe selectorii cheerio fiabili.
- `extractOfferEndFromHtml` nu mai cauta data de expirare in tot `body.text()` cand selectorul `.game_purchase_discount_countdown` lipseste. Fallback-ul e restrans la `.game_area_purchase, .game_purchase_action, .discount_block` ca sa nu prinda din greseala "Offer ends ..." dintr-un sidebar de produs nelegat.
- `handleAutocomplete` adauga un tiebreaker alfabetic pe nume cand mai multi candidati au acelasi scor, ca ordinea sugestiilor sa nu mai sara aleator intre apasarile de tasta.
- `processGuildDiscounts` calculeaza `dealHash` o singura data per deal, prin `orderedHashes` + `dealsByHash`, in loc sa-l recalculeze in al doilea loop.

## TypeScript complet pe sursa

Codul sursa din `src` a fost mutat la TypeScript. JavaScript-ul ramas este output generat in `src/dist/` dupa build, nu sursa editata manual.

Conversii facute anterior:

- `src/config/configValidator.ts` si `src/config/configLoader.ts` tipizeaza config-ul si rezultatul de boot.
- `src/shared/errors.ts`, `src/shared/logging.ts`, `src/shared/env.ts`, `src/shared/domain.ts`, `src/shared/utilities.ts` tin baza comuna.
- `src/infra/http/client.ts` tipizeaza clientul HTTP comun.
- `src/infra/mongo/guildSettings.ts`, `adminAlerts.ts`, `locks.ts`, `systemState.ts`, `migrations.ts` tin infrastructura Mongo critica.
- `src/sources/steam/index.ts`, `src/sources/deals/index.ts`, `src/sources/updates/index.ts` tipizeaza sursele externe.
- `src/app/scheduler/cron.ts`, `housekeeping.ts`, `src/app/lifecycle/events.ts`, `shutdown.ts` si `src/app/health/*.ts` tipizeaza runtime-ul aplicatiei.
- `src/domain/deals/filters.ts`, `src/features/commands/cache.ts`, `ui.ts`, `slashCommands.ts` si `index.ts` tipizeaza regulile de comenzi si domeniu.

Conversii facute in pasul mare de runtime:

- `src/app/main.js` -> `src/app/main.ts`.
- `src/infra/mongo/runtime.js` -> `src/infra/mongo/runtime.ts`.
- `src/infra/mongo/index.js` -> `src/infra/mongo/index.ts`.
- `src/infra/mongo/models.js` -> `src/infra/mongo/models.ts`.
- `src/sources/runtime.js` -> `src/sources/runtime.ts`.
- `src/sources/index.js` -> `src/sources/index.ts`.
- `src/features/commands/interactions.js` -> `src/features/commands/interactions.ts`.
- `src/features/notifications/index.js` -> `src/features/notifications/index.ts`.
- `src/scripts/check-config.js` -> `src/scripts/check-config.ts`.
- `src/scripts/check-syntax.js` -> `src/scripts/check-syntax.ts`.
- `src/test/commands-regression.test.js` -> `src/test/commands-regression.test.ts`.
- `src/test/configValidator.test.js` -> `src/test/configValidator.test.ts`.

Corectie finala dupa ce CI a aratat ca mai ramasesera 5 fisiere JavaScript de test:

- `src/test/buildOptimizedGameList.test.js` -> `src/test/buildOptimizedGameList.test.ts`.
- `src/test/dealHash.test.js` -> `src/test/dealHash.test.ts`.
- `src/test/extractOfferEndFromHtml.test.js` -> `src/test/extractOfferEndFromHtml.test.ts`.
- `src/test/findGameAndSuggestion.test.js` -> `src/test/findGameAndSuggestion.test.ts`.
- `src/test/safeCheerioLoad.test.js` -> `src/test/safeCheerioLoad.test.ts`.

## Rust gradual

Rust este limitat la algoritmi puri si repetitivi, unde ajuta fara sa mute Discord, Mongo sau HTTP peste granita N-API.

Primul pas Rust:

- `src/native/src/lib.rs` implementeaza in Rust `levenshtein` si un helper bulk pentru fuzzy matching.
- `src/native/package.json` da metadata N-API pentru build-ul addon-ului.
- `src/native/fuzzy.ts` este puntea TypeScript catre addon-ul nativ si are fallback TypeScript pentru dezvoltare locala cand binarul lipseste.
- `src/sources/steam/index.ts` foloseste `levenshtein` din `src/native/fuzzy.ts`, deci alegerea celui mai bun rezultat Steam si fuzzy matching-ul din comenzi primesc nucleul Rust prin contextul comun.
- `src/test/rustFuzzy.test.ts` verifica explicit ca addon-ul Rust este incarcat in CI.

Al doilea pas Rust:

- `src/native/src/lib.rs` expune si `normalize_title_for_dedupe`, `stable_update_id`, `normalize_deal_state` si `deal_hash`.
- `src/native/Cargo.toml` adauga `sha1`, ca hash-urile stabile sa fie calculate in nucleul Rust.
- `src/native/fuzzy.ts` expune wrapper-ele TypeScript `normalizeTitleForDedupe`, `stableUpdateId`, `normalizeDealState` si `dealHash`, cu fallback-uri compatibile.
- `src/infra/http/client.ts` pastreaza aceleasi functii publice pentru restul codului, dar deleaga normalizarea/hash-ul catre wrapper-ele Rust.
- `src/test/rustFuzzy.test.ts` acopera normalizarea titlurilor, ID-urile stabile de update si hash-urile pentru Steam, Epic si listing-based deals.

Optimizari la nucleul Rust de hashing:

- `stable_update_id` nu mai formateaza tot SHA1-ul (40 chars) ca sa pastreze doar primii 16. Acum trece direct prin primii 8 bytes ai digest-ului catre `hex_encode`, evitand alocarea string-ului intermediar de 40 chars.
- `sha1_hex` foloseste acelasi `hex_encode` ca sa pastreze consistenta. `hex_encode` aloca o data capacitatea exacta si scrie direct in buffer fara `format!` per byte.
- `rustFuzzy.test.ts` adauga o asertie ca `stable_update_id` returneaza intotdeauna exact 16 chars hex lowercase, independent de input.

Atentie: schimbarea este pur intern micro-optimizare; output-ul `stable_update_id` si `deal_hash` ramane identic cu inainte, deci hash-urile stocate in `seen.*` si `seenDiscounts` raman valide.

Nu am mutat in Rust zonele de Discord, Mongo, HTTP, retry/backoff, proxy fallback sau parsare HTML in acest pas, pentru ca acolo timpul real este dominat de retea/IO si riscul ar fi mai mare decat castigul.

## Schimbari de build

- `src/tsconfig.json` foloseste `moduleDetection: force`, ca fisierele TypeScript fara import explicit sa fie tratate ca module si sa nu polueze scope-ul global.
- `src/tsconfig.json` are `allowJs: false` si nu mai include `**/*.js`, ca sursa editabila sa fie TypeScript.
- `src/scripts/check-syntax.ts` pica CI-ul daca mai exista fisiere `.js` in sursa `src`, dar ignora `dist` si loader-ul N-API generat `native/index.js`.
- `src/package.json` are `build:rust`, `build:ts` si `build`, iar `npm run check` compileaza addon-ul Rust inainte de testare.
- `.github/workflows/ci.yml` instaleaza toolchain-ul Rust inainte de `npm install` si `npm run check`.
- `src/.gitignore` ignora output-ul generat: `dist/`, `node_modules/`, `native/target/`, fisierele native `.node`, `native/index.js` si `native/index.d.ts`.
- `src/legacy-dynamic.d.ts` pastreaza compatibilitatea pentru cateva obiecte legacy construite dinamic in fisierele mari convertite. Este o masura temporara de migrare, nu un model de urmat pentru cod nou.
- `src/sources/index.ts` expune si exporturi TypeScript pentru helper-ele folosite de testele existente.

## GitHub Actions

Singura exceptie intentionata din afara `src` ramane `.github/workflows/ci.yml`, fiindca GitHub Actions ruleaza workflow-uri doar din acel folder special.

Workflow-ul:

- ruleaza pe push, pull request si `workflow_dispatch`;
- foloseste Node.js 20;
- instaleaza Rust stable;
- lucreaza cu `working-directory: src`;
- ruleaza `npm run check`.

Fluxul recomandat ramane branch separat si Pull Request catre `main`, ca GitHub sa arate checks inainte de merge.

## Ce nu am copiat 1:1

Fisierele locale mari erau monolitice. Repo-ul de pe GitHub ramane impartit pe functionalitati:

- `commands.js` -> `src/features/commands/*` si `src/features/notifications/index.ts`;
- `scrapers.js` -> `src/infra/http/client.ts`, `src/native/*` si `src/sources/*`;
- `db.js` -> `src/shared/*` si `src/infra/mongo/*`;
- `index.js` -> `src/app/*`.

Nu am copiat fisiere intregi din folderul local si nu am readus fisiere duplicate in afara lui `src`.
