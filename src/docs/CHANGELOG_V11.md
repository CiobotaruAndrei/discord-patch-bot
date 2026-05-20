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

## Acoperire de teste comportamentale

- `src/features/notifications/index.ts` expune acum prin `ctx` si `resolveOutboundChannel` + `transientErrorMessage`, ca testele sa poata exercita direct ramurile permanent vs tranzitoriu.
- `src/test/resolveOutboundChannel.test.ts` mock-eaza `client.channels.fetch` si verifica comportamental ca: (1) codurile permanente cheama `disableFn` si aborteaza ciclul, (2) erorile tranzitorii NU cheama `disableFn`, (3) `fetch` rezolvand `null` e tratat ca canal sters, (4) lipsa permisiunilor Send/Embed dezactiveaza, (5) happy path returneaza canalul. Acopera si `isPermanentDiscordError` cu cele 4 coduri + cazuri negative si `transientErrorMessage` pe diverse input-uri.

Pana acum `commands-regression.test.ts` doar verifica prezenta sirurilor in source-ul compilat, deci fix-ul transient/permanent ramasese fara test real. Acum exista o asertie pe comportament, nu doar pe text.

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

## Boot resilience

- `app/main.ts` conecteaza Mongo printr-un retry exponential (5 incercari, backoff 1s -> 16s cu jitter). Inainte, un network blip la pornire crash-uia bot-ul si platforma (Docker/k8s) il restart-uia; acum fereastra tipica de start a Mongo (~5-15s) e tolerata fara restart inutil. Dupa ultima incercare esuata, ramane comportamentul vechi: alerta admin `boot:fatal` si `process.exit(1)`.

## Diagnosticare scraper-uri si robustete error handling

- `fetchFortniteUpdate` nu mai face `catch {}` mut: logheaza un WARN cu motivul cand cade pe RSS Google News. Inainte, daca API-ul oficial Fortnite isi schimba forma, falleam permanent pe fallback fara niciun semnal.
- `fetchAmdUpdate` si `fetchIntelUpdate` logheaza explicit cand regex-ul de versiune (`Adrenalin Edition X.Y.Z`, respectiv `\d+.\d+.\d+.\d+`) nu match-uieste continutul primit prin proxy — semnal de schema drift care inainte trecea neobservat fiindca executia cadea direct in RSS.
- AMD/Intel RSS fallback nu mai produc entry-uri cu titlu/id gol: daca `feed.items[0].title` lipseste sau `cleanText(...).split(" - ")[0]` da string gol, throw cu mesaj explicit ca sa intre circuit breaker-ul.
- `extractOfferEndFromHtml` ruleaza raw-HTML fallback DOAR cand cheerio arunca. Daca cheerio parseaza cu succes dar n-am gasit text in `.game_area_purchase / .game_purchase_action / .discount_block`, returnam `null` in loc sa scanam tot documentul — eliminam un drum prin care sidebar-ul "Customers also bought" putea adauga data unui produs nelegat la embed.
- `interactions.ts` foloseste `errorMessage` / `errorDetail` din `shared/errors` pentru toate cele 17 site-uri de `err.message` / `err.stack || err.message`. Inainte, daca handler-ul prindea ceva non-Error (string aruncat dintr-o lib third-party), log-ul afisa `undefined` si campul `updatesLastError.message` ramanea nedefinit in Mongo.
- `processGuildUpdates` indexeaza `latestResults` intr-un `Map<gameKey, result>` o data per guild, in loc sa faca `find()` linear in bucla de trimitere — O(1) lookup la fiecare iteratie.

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

Al treilea pas Rust — helperi de text in hot path:

- `src/native/src/lib.rs::clean_text` inlocuieste pipeline-ul JS `CLEAN_REGEX` din `infra/http/client.ts`. Implementare hand-rolled byte scanner, fara dependinte Cargo noi, care strip-uieste tag-uri HTML, decodeaza entitatile `&nbsp; &amp; &quot; &#39; &apos; &lt; &gt;` (case-insensitive, preserva cele necunoscute) si colapseaza whitespace-ul. UTF-8 multibyte e copiat intact.
- `src/native/src/lib.rs::classify_patch_note` muta `isLikelyPatchNote` in nucleu. Listele `BAD_IN_TITLE` (12 cuvinte) si `GOOD_WORDS` (23 cuvinte) sunt static slices, alocate o data la incarcarea addon-ului. `fetchSteamUpdate` ruleaza clasificarea pana la 50 ori per joc per ciclu cron; bridge-ul JS<->native se traverseaza acum o data per item, nu o data per cuvant.
- `src/native/src/lib.rs::score_listing_candidate` muta `scoreCandidate` in nucleu. Lowercasing-ul haystack-ului se face o singura data per ancora, nu o data per keyword. Bucla peste keywords ruleaza integral in cod nativ.
- `src/native/fuzzy.ts` expune `cleanText`, `classifyPatchNote` si `scoreListingCandidate`, fiecare cu fallback TypeScript care oglindeste comportamentul Rust pentru dezvoltarea locala fara binar `.node`.
- `src/infra/http/client.ts::cleanText` si `src/sources/updates/index.ts::isLikelyPatchNote` / `scoreCandidate` sunt acum delegatori de o linie catre wrapper-ele Rust. Listele de cuvinte cheie au fost scoase din bundle-ul JS — Rust e sursa unica acum.
- `src/test/rustFuzzy.test.ts` acopera entity decode, unknown-entity passthrough, whitespace collapse, UTF-8 multibyte, plus reguli `classifyPatchNote` (bad-in-title invinge good word, tag patchnotes/update castiga, etc.) si `scoreListingCandidate` (case-insensitive, keyword gol, lista goala).

Atentie: acesti helperi nu schimba semantica vizibila pentru consumatorii lor — output-ul `cleanText`, decizia `isLikelyPatchNote` si scorul `scoreCandidate` raman identice cu inainte. Doar costul per apel scade.

Al patrulea pas Rust — URL helpers la cron hot path:

- `src/native/src/lib.rs::is_good_steam_article_url` muta verificarea per news item Steam in Rust. fetchSteamUpdate o ruleaza pana la 50 ori per joc per ciclu cron; ramane in JS doar wrapper-ul TS cu fallback identic.
- `src/native/src/lib.rs::extract_date_score` muta in Rust scorul de sortare al ancorelor din `fetchListingBasedUpdate`. Implementare hand-rolled byte scanner pentru YYYY-MM-DD / YYYY/MM/DD plus algoritmul `days_from_civil` (Howard Hinnant) — fara dependinte `regex` / `chrono`. Acceptarea anilor bisecti (2024-02-29 da, 2023-02-29 nu) si respingerea roll-over (Feb 31) sunt aceleasi ca in JS.
- `src/sources/updates/index.ts::isGoodSteamArticleUrl` si `extractDateScore` devin delegatori de o linie catre wrapper-ele din `src/native/fuzzy.ts`.
- `src/test/rustFuzzy.test.ts` acopera ambele functii cu cazuri pozitive si negative (CDN/non-http rejected, leap year, roll-over, separator `-` vs `/`, intervale out-of-range).

Bug fix-uri si perf in acelasi PR:

- `infra/http/client.ts` retry-uieste 429 chiar si pe POST. Singurul POST din codebase este Epic GraphQL deals query — o cerere semantic de citire. Inainte cadea direct pe `throw` si pierdeam toate ofertele Epic intr-un ciclu cron la primul rate-limit. Acum onoreaza header-ul `Retry-After` ca si pe GET. Drive-by: cele doua aparitii `err.message` din `httpReq` au fost inlocuite cu `errorMessage(err)` pentru cazurile non-Error.
- `features/notifications/index.ts::processGuildDiscounts` partajeaza index-ul `(hash -> snapshot)` intre toate guild-urile din acelasi ciclu printr-un `WeakMap<DealInfo[], { dealsByHash, orderedHashes }>` keyed pe referinta array-ului `deals`. Cu 100 de guild-uri si 50 de deal-uri scapam de 5000 de apeluri `dealHash` per ciclu si pastram doar 50.

Curatare finala `err.message` in notifications:

- `features/notifications/index.ts` foloseste acum `transientErrorMessage` (helper-ul local existent) in toate cele 7 site-uri ramase care citeau `err.message` direct: ramurile permanent-error din `resolveOutboundChannel`/`processGuildUpdates`/`processGuildDiscounts` (cele cu sablonul `Discord cod ${code}: ${message}`), log-urile de send-failure din ambele bucle, catch-ul outer din `checkForUpdates` si cele doua `errorLogger` din `runConcurrent`. Inainte, pe un throw non-Error (string, numar, obiect simplu), log-ul afisa `undefined` iar campurile Mongo `updatesLastError.message` / `discountsLastError.message` ramaneau nedefinite.

Bug fix-uri si perf, pasul 6:

- `sources/deals/index.ts::enrichedCache` foloseste cheie compusa `${dealId}:${currency}` in loc de `dealId` singur. Inainte, in deployment multi-currency, fiecare cerere de enrichment in alta currency suprascria entry-ul existent, fortand re-enrichment continuu pentru ambele tabere — cache-ul era efectiv inactiv. Acum USD/EUR/etc. coexista cu intrari separate. Tipul Map e si el restrans la `Map<string, …>`.
- `app/lifecycle/shutdown.ts` face acum `await client.destroy()`. In discord.js v14 metoda intoarce `Promise<void>`, dar codul vechi o apela sync ca pe v13 — WebSocket teardown si ratelimit-queue drain rulau in paralel cu `mongoose.connection.close()` si cu timer-ul de 500 ms de exit, iar un eventual reject scapa de catch-ul sincron. Acum cleanup-ul Discord intra pe drumul critic al shutdown-ului si rejection-urile sunt prinse.
- `sources/updates/index.ts::fetchListingBasedUpdate` fetch-uieste `game.listingUrls` paralel via `Promise.allSettled`. Inainte, un URL lent intarzia toate celelalte sub `await` secvential. Pozitiile candidatilor (folosite ca tiebreaker la sort) sunt reasamblate post-settle in ordinea declarata a URL-urilor din config, asa incat decizia "primul rezultat" ramane deterministica chiar daca URL-urile termina in ordine diferita.

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
