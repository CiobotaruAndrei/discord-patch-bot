# V11 - schimbari utile portate

Acest document noteaza ce a fost pastrat din fisierele locale si cum a fost organizat repo-ul dupa curatare si migrarea la TypeScript.

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

Schimbari de build:

- `src/tsconfig.json` foloseste `moduleDetection: force`, ca fisierele TypeScript fara import explicit sa fie tratate ca module si sa nu polueze scope-ul global.
- `src/tsconfig.json` are `allowJs: false` si nu mai include `**/*.js`, ca sursa editabila sa fie TypeScript.
- `src/scripts/check-syntax.ts` pica CI-ul daca mai exista fisiere `.js` in sursa `src` in afara de output-ul ignorat din `dist`.
- `src/legacy-dynamic.d.ts` pastreaza compatibilitatea pentru cateva obiecte legacy construite dinamic in fisierele mari convertite. Este o masura temporara de migrare, nu un model de urmat pentru cod nou.
- `src/sources/index.ts` expune si exporturi TypeScript pentru helper-ele folosite de testele existente.
- `npm run check:syntax` ruleaza scriptul compilat din `dist/scripts/check-syntax.js`.
- `npm start`, `npm test`, `npm run check:config` si `npm run check` continua sa foloseasca output-ul compilat.

## GitHub Actions

Singura exceptie intentionata din afara `src` ramane `.github/workflows/ci.yml`, fiindca GitHub Actions ruleaza workflow-uri doar din acel folder special.

Workflow-ul:

- ruleaza pe push, pull request si `workflow_dispatch`;
- foloseste Node.js 20;
- lucreaza cu `working-directory: src`;
- ruleaza `npm run check`.

Fluxul recomandat ramane branch separat si Pull Request catre `main`, ca GitHub sa arate checks inainte de merge.

## Ce nu am copiat 1:1

Fisierele locale mari erau monolitice. Repo-ul de pe GitHub ramane impartit pe functionalitati:

- `commands.js` -> `src/features/commands/*` si `src/features/notifications/index.ts`;
- `scrapers.js` -> `src/infra/http/client.ts` si `src/sources/*`;
- `db.js` -> `src/shared/*` si `src/infra/mongo/*`;
- `index.js` -> `src/app/*`.

Nu am copiat fisiere intregi din folderul local si nu am readus fisiere duplicate in afara lui `src`.
