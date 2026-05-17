# V11 - schimbari utile portate

Acest document vine din fisierele locale din `Discord bot` si noteaza ce a fost util de pastrat in repo-ul organizat pe functionalitati.

## Bug fix-uri si imbunatatiri portate

- `METRICS_TOKEN` placeholder (`change_me_to_a_long_random_value`) este tratat ca lipsa, ca sa nu para production-safe din greseala.
- `safeCheerioLoad` taie HTML-ul mare pe limita de bytes fara sa rupa caractere UTF-8.
- `dealHash` nu mai include `endDateStr`, deci o oferta nu devine alta oferta doar fiindca s-a schimbat textul datei de expirare.
- `extractOfferEndFromHtml(html)` parseaza mai robust textele Steam de tip `Offer ends`, `Sale ends`, `Special promotion ends`, `Daily Deal! Offer ends`.
- `enrichDealData` foloseste parser-ul robust pentru data de expirare Steam.
- `getLatestForAllGames` foloseste cache key bazat pe lista efectiva de jocuri, ca sa separe cron-ul optimizat de fetch-urile manuale.
- `buildOptimizedGameList(allGames, subscribedGuilds)` evita scraping-ul jocurilor nefolosite de niciun guild abonat.
- `findGameAndSuggestion` are cache LRU pentru autocomplete/fuzzy matching.
- HTTP foloseste agenti keep-alive pentru reutilizarea conexiunilor.
- A fost adaugat un sistem simplu de migrari DB la pornire.
- A fost adaugata schema JSON pentru `config.json`.
- Au fost adaugate teste functionale pentru noile zone sensibile.

## TypeScript gradual

Am inceput migrarea reala la TypeScript acolo unde merita cel mai mult:

- `src/config/configValidator.js` a devenit `src/config/configValidator.ts`;
- `src/shared/errors.js` a devenit `src/shared/errors.ts`;
- build-ul TypeScript genereaza runtime-ul in `src/dist/`;
- `npm start`, `npm test`, `npm run check:config` si `npm run check` folosesc output-ul compilat;
- `check-syntax` ignora `dist/`, ca sa nu verifice de doua ori fisiere generate.

Nu am convertit toate fisierele mari dintr-o singura trecere, pentru ca `commands`, `notifications`, `sources` si `infra/http` sunt zone sensibile si trebuie migrate in pasi mai mici, cu teste clare.

## GitHub Actions

A fost facuta o singura exceptie intentionata de la regula "totul in `src`":

- workflow-ul real este in `.github/workflows/ci.yml`, fiindca GitHub Actions ruleaza doar workflow-uri aflate acolo;
- copia veche din `src/.github/workflows/ci.yml` a fost stearsa, pentru ca nu era executata de GitHub;
- jobul CI ruleaza cu `working-directory: src`, instaleaza dependintele si executa `npm run check`.

## Ce nu am copiat 1:1

Fișierele locale mari (`commands.js`, `scrapers.js`, `db.js`, `index.js`) erau monolitice. Repo-ul de pe GitHub este deja impartit mai bine pe functionalitati, asa ca logica utila a fost mutata in modulele potrivite:

- `commands.js` -> `src/features/commands/*` si `src/features/notifications/index.js`;
- `scrapers.js` -> `src/infra/http/client.js`, `src/sources/*`;
- `db.js` -> `src/shared/*` si `src/infra/mongo/*`;
- `index.js` -> `src/app/*`.

Astfel repo-ul ramane organizat si nu revine la fisiere mari duplicate.
