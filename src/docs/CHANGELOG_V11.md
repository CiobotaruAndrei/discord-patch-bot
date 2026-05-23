# V11 - stare curenta si schimbari utile

Acest document noteaza starea repo-ului dupa curatare, migrarea sursei la TypeScript, introducerea graduala a Rust, setup-ul de CI/Docker si ultimele imbunatatiri pentru testare, release, GHCR, securitate, dependinte npm si reducerea treptata a contextului legacy.

## Stare curenta

- Codul editabil al aplicatiei este in `src/`.
- JavaScript-ul ramas este output generat in `src/dist/` sau loader N-API generat, nu sursa manuala.
- Dependintele sunt blocate prin `src/package-lock.json`, iar CI foloseste `npm ci`.
- `src/package.json` foloseste versiuni exacte pentru dependintele directe runtime si build/dev.
- `src/tsconfig.json` ruleaza proiectul cu `strict: true` si `noImplicitAny: true`.
- `src/tsconfig.strict.json` include zone stabilizate explicit din health, scheduler, `filtersCore`, command registry, command cache, command presentation, slash command definitions, command handlers, command security, `outboundChannel`, `sourceRegistry`, `check-dependencies`, `extract-release-notes`, HTTP client si teste directe.
- Fisierele de comenzi au fost mutate din folderul plat `src/features/commands/` in foldere numite dupa functionalitate: `command-registry`, `command-runtime`, `command-cache`, `command-presentation`, `command-definitions`, `command-security`, `command-handlers` si `command-router`.
- Vechiul folder `src/features/commands/` nu mai contine sursa manuala. Routerul ramas pentru `/latest`, `/dlc`, `/status` si autocomplete este acum in `src/features/command-router/legacyInteractionRouter.ts`.
- `src/legacy-dynamic.d.ts` ramane doar shim temporar pentru codul vechi care construieste contextul dinamic.
- `.github/workflows/ci.yml` ruleaza verificarea principala.
- `.github/workflows/dependency-audit.yml` ruleaza audit npm saptamanal si manual.
- `.github/workflows/dependency-review.yml` ruleaza Dependency Review pe PR-uri care ating manifestele npm sau workflow-urile si devine blocant cand GitHub Dependency graph este activ.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript la push, PR, saptamanal si manual.
- `.github/workflows/release.yml` ruleaza `npm run check`, extrage notele pentru tag-ul curent din `CHANGELOG.md`, publica imaginea Docker in GHCR si creeaza GitHub Release pentru tag-uri `v*.*.*`.
- `Dockerfile` ruleaza runtime-ul ca user non-root `node`.
- `.github/dependabot.yml` deschide PR-uri saptamanale pentru dependinte npm din `src` si pentru GitHub Actions.
- `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTEXT_REPO_CLEAN.md`, `FUNCTION_MAP_CLEAN.md` si acest document au fost actualizate cu noile verificari, refactorizari si foldere de comenzi.

## Rectificari recente din feedback

- `src/features/command-security/adminPermissionGuard.ts` verifica runtime daca utilizatorul are Administrator.
- `src/features/command-security/adminCommandRouterGuard.ts` inveleste comenzile `/start`, `/stop` si `/set` si blocheaza non-adminii inainte de a ajunge la handler-ele care schimba starea serverului.
- `src/features/command-handlers/helpInteractionHandler.ts` extrage `/help` intr-un handler mic, testabil si instalat peste handlerul legacy.
- `src/features/command-definitions/slashCommandDefinitions.ts` este inclus in `tsconfig.strict.json` si foloseste tipuri locale pentru builder-ele Discord in loc de multe callback-uri `any`.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts` extrage `/start updates`, `/stop updates`, `/start reduceri` si `/stop reduceri` intr-o factory tipata cu dependinte explicite.
- `src/features/command-handlers/gameFilterHandlers.ts` extrage `/set games add/remove/list/reset` intr-o factory tipata cu dependinte explicite.
- `src/features/command-handlers/rolePingHandlers.ts` extrage `/set role updates/discounts` intr-o factory tipata cu dependinte explicite.
- `src/features/command-registry/commandRegistry.ts` a fost mutat intr-un folder de registru si foloseste importuri dupa functionalitate in loc de fisiere plate.
- `src/features/command-router/legacyInteractionRouter.ts` tine acum direct routerul legacy ramas, ca nu mai fie nevoie de un fisier vechi in `features/commands`.
- `src/test/commands-regression.test.ts` citeste acum folderele compilate din `dist/features`, ca testele de regresie sa urmeze structura functionala in loc de nume vechi de fisiere.
- `src/scripts/extract-release-notes.ts` extrage doar sectiunea tag-ului curent din `CHANGELOG.md`, iar release workflow-ul foloseste `release-notes.md` in loc de tot changelog-ul.
- `Dockerfile` face `chown` pe `/app` si trece pe `USER node` in runtime.
- `dependency-review.yml` nu mai foloseste `continue-on-error: true` pe pasul de review. Workflow-ul verifica intai daca GitHub Dependency graph este activ; cand este activ, `actions/dependency-review-action@v4` ruleaza ca verificare blocanta pentru vulnerabilitati moderate sau mai grave.
- `src/package.json` pin-uieste exact si build/dev dependencies directe, inclusiv `@napi-rs/cli`.
- `src/scripts/check-dependencies.ts` verifica runtime si build/dev dependencies directe, plus versiunile rezolvate in lockfile si URL-urile din registry npm.
- `README.md` mentioneaza explicit ca testele CI nu pot confirma comportamentul live complet fara server Discord, token, Mongo si surse externe reale.
- `src/features/command-router/legacyInteractionRouter.ts` si cele patru installer-e (`helpInteractionHandler`, `subscriptionNotificationHandlers`, `gameFilterHandlers`, `rolePingHandlers`) folosesc acum `return await` in dispatchere. Forma veche `return inner()` lasa rejectul asincron sa treaca pe langa `try/catch`, deci user-ul nu mai primea niciodata reply-ul "Eroare neasteptata la procesarea comenzii" cand un sub-handler arunca asincron.
- `src/features/command-presentation/commandPresentation.ts::fetchGameStatus` inchide marker-ul de italic in mesajul "*(Acesta nu este un API live de status.)*" — fara `*` final Discord randa fie un asterisc literal, fie continua italic-ul peste continutul urmator. Acelasi handler log-uieste acum cand `status.epicgames.com` esueaza in loc sa inghita eroarea fara urma.
- `src/infra/http/client.ts::httpReq` respecta `Retry-After` pe 429. Jitter-ul `[0.5, 1.5)` aplicat peste tot insemna ca un Retry-After de 30s putea fi asteptat doar ~15s, sub pragul cerut de server. Acum, cand server-ul trimite `Retry-After`, folosim jitter pozitiv `[1.0, 1.25]` peste valoare ca sa pastram pragul si sa evitam thundering herd.
- `src/app/scheduler/cron.ts::runCronCycle` foloseste `Promise.allSettled` in loc de `Promise.all` pentru cele doua job-uri de ciclu (`checkForUpdates`, `checkForDiscounts`). Cu `Promise.all`, daca update-urile respingeau prima, ciclu intra in `catch` si `finally` elibera lock-ul distribuit cat timp reducerile inca rulau in background, orfan. Acum asteptam ambele job-uri inainte de release si emitem un singur `cron:fatal` combinat cand ambele esueaza. Regresia este blocata de `src/test/cronController.test.ts`, care valideaza ordinea finish-discounts ⇒ release-lock chiar cand update-urile arunca primul.
- `src/infra/mongo/guildSettings.ts` are acum bound LRU pe `guildSettingsCache` prin `GUILD_CACHE_MAX_SIZE` (default 1000). Inainte Map-ul crestea nelimitat — singura curatire era `cleanGuildCache` din housekeeping si numai pentru intrari expirate. Sub trafic cu multe guild-uri unice in TTL window, am fi tinut toate setarile in memorie pana la urmatorul housekeeping tick. Restul cache-urilor (deals, single, dlc, enriched, findGame) au deja bound. Regresia este blocata de `src/test/guildSettingsCache.test.ts`.
- `src/sources/updates/index.ts::executeFetchWithCircuitBreaker` aplica acum cooldown si pe schema drift, nu doar pe esecuri normale. Inainte: la prag, alerta admin se trimitea o data, dar sursa stricata era refetch-uita la fiecare ciclu — botul lovea o pagina cu selectori invechiti la nesfarsit. Acum: aceeasi formula `CIRCUIT_BREAKER_COOLDOWN_MS + jitter` parchea sursa pana cand upstream-ul se recupereaza singur sau pana cand operatorul intervine.
- `src/features/command-router/legacyInteractionRouter.ts::handleLatestSingleInteraction` si `handleStatusInteraction` aveau cooldown lipsa, spre deosebire de celelalte comenzi user (`latest updates`, `latest reduceri`, `latest pret`, `dlc`). Acum ambele cheama `enforceCooldown(interaction, …)` si `/status` capata si `startCommandLog`/`endLog` ca sa intre in audit la fel ca restul.
- `src/infra/mongo/systemState.ts` are functia noua `saveSystemTime(key, value)` care scrie un singur camp prin dot-path (`executionTimes.${key}`). Pattern-ul vechi `getSystemTimes` → mutate one field → `saveSystemTimes(sys)` rescria intregul obiect `executionTimes`, deci doua comenzi paralele care actualizau chei diferite pierdeau una pe alta. Toate cele trei callsite-uri din router au fost migrate; regresia este blocata de `src/test/systemStatePerKey.test.ts`. `saveSystemTimes` ramane exportat pentru backwards compatibility.
- `src/app/lifecycle/shutdown.ts` asteapta acum efectiv inchiderea HTTP server-ului. Forma veche `try { httpServer.close(); } catch {}` lansa close-ul fara sa astepte callback-ul — `Server.close()` din `node:http` returneaza server-ul, nu un Promise — deci o cerere mid-flight pe `/metrics` sau `/health` putea fi rupta abrupt cand timer-ul de exit la 500ms se aprindea. Acum wrap-uim close-ul intr-un Promise resolved pe callback, intr-o cursa cu un buget de 3s (`HTTP_CLOSE_BUDGET_MS`) ca o conexiune blocata sa nu impiedice shutdown-ul. Regresia este blocata de `src/test/shutdownHttpDrain.test.ts`.
- `src/sources/deals/index.ts::enrichDealData` construieste acum URL-ul HTML al app-ului Steam cu `new URL(...).searchParams.set` in loc de concatenare raw `${link}?cc=...&l=english`. Codul deal-fetch curent produce link-uri fara query string, deci bug-ul nu se aprinde in productie azi, dar o singura sursa viitoare care adauga un `?utm_*=*` la link rupea silentios fiecare enrichment Steam.
- `src/sources/updates/index.ts::fetchListingBasedUpdate` filtreaza explicit URL-urile falsy din `listingUrls` inainte de fetch. Cand `game.listingUrls` era array gol si `game.listingUrl` era undefined, fallback-ul producea `[undefined]` si pornea un `httpReq` cu undefined ca URL — log de WARN inselator ("Eroare preluare listing url undefined") si slot irosit in Promise.allSettled. Acum aruncam o eroare clara cu cheia jocului daca toate URL-urile lipsesc.
- `src/features/command-router/legacyInteractionRouter.ts::handleSetInteraction`, `handleSetGames` si `handleSetRole` au acum guard-uri explicite pentru sub-comenzi necunoscute. Trei gauri defensive: (1) `handleSetInteraction` rula `GuildModel.updateOne({_id}, { $set: {} }, { upsert: true })` care, pe un guild fara document, INSERA o intrare goala cu doar `_id` — poluare a coleciei; (2) `handleSetGames` cadea peste sfarsitul functiei fara `safeEdit`, lasand user-ul pe loading-ul de deferReply pentru totdeauna; (3) `handleSetRole` defaulta tacit la `discountRoleId` pentru ORICE sub care nu era exact "updates" prin ternary-ul vechi — o sub-comanda viitoare cu nume gresit putea sa rescrie configurarea de rol de discount fara warning. Acum toate trei detecteaza explicit sub-ul necunoscut, log-uiesc WARN si raspund user-ului cu eroare clara. Regresia este blocata de `src/test/setSubcommandGuards.test.ts` cu patru cazuri.
- `src/app/main.ts` ataseaza acum un listener `httpServer.on("error", ...)` inainte de `listen()`. Inainte, daca port-ul era ocupat (deploy paralel, restart prea rapid), Node emitea un eveniment `error` fara listener si bubbling-ul ajungea la `process.on("uncaughtException")` din shutdown controller — bot-ul cadea, dar log-urile nu indicau clar problema HTTP. Acum log-am explicit eroarea cu port-ul si trimitem alerta `http:listen` inainte de shutdown.
- `src/app/health/httpServer.ts` are acum un global try/catch in jurul request handler-ului. Daca `commands.getCacheSizes()`, `cronController.getHealthSnapshot()` sau orice alt service injectat arunca sincron, vechea forma crasha cererea fara raspuns — clientul (Prometheus / Kubernetes liveness) primea connection reset si declansa fals-pozitive in monitoring. Acum incercam un 500 cand inca avem headers ne-scrise, ori cel putin terminam conexiunea curat in `res.end`.
- `src/config/configValidator.ts` enforce-eaza acum `baseUrl` si `listingUrl/listingUrls` pentru sursele `epic_games` non-fortnite. `fetchGameUpdate` ruta orice `type: "epic_games"` cu `key !== "fortnite"` catre `fetchListingBasedUpdate`, care necesita aceste campuri — fara ele, configul trecea validarea de boot dar prima cerere cron arunca "Nu am URL-uri de listing valide pentru …". Fortnite ramane exceptie pentru ca foloseste implementarea proprie `fetchFortniteUpdate`. Regresia este blocata de `src/test/configValidator.test.ts` cu patru cazuri (fortnite valid; non-fortnite fara nimic; non-fortnite cu listingUrl dar fara baseUrl; non-fortnite complet).
- `src/features/command-router/legacyInteractionRouter.ts::handleSetGames` accepta acum `/set games remove <joc>` pentru chei stale (in `enabledGames` dar nu mai exista in config). Vechea forma respingea cu "Cheia nu exista in config" — operatorul ramanea blocat cu intrari stale dupa o curatare in config.json. `$pull` ruleaza acum neconditionat; daca modificarea n-a schimbat nimic, raspundem cu "nimic de scos"; pentru chei stale adaugam nota explicit. `add` pastreaza validare stricta. Autocomplete-ul pentru `/set games remove` include placeholder-uri pentru cheile stale (`<key> (cheie stale)`) ca operatorul sa le poata selecta direct. Regresia este blocata de `src/test/setGamesStaleKey.test.ts` cu trei cazuri.
- `src/features/command-router/legacyInteractionRouter.ts::handleStatusInteraction` valideaza acum `gameText` empty inainte de orice defer sau loading message. Slash command-ul declara `joc` ca required dar payload-uri malformate puteau trimite null, iar vechea forma arata "Se incarca: ... pentru **null**..." inainte de fallback-ul generic. Acum reply explicit "Trebuie sa specifici un joc" inainte sa pornim work-ul. Simetric cu `/latest update` si `/latest pret`. Regresia este blocata in acelasi fisier de test.
- `src/sources/updates/index.ts::executeFetchWithCircuitBreaker` izoleaza acum scrierile Mongo de bookkeeping intr-un try/catch separat. Inainte: daca `findOneAndUpdate $inc fails` sau orice alta scriere din catch-ul cycle-ului arunca (Mongo blip, replica step-down), eroarea Mongo se propaga in loc de `FetchResult { error: <fetch-msg> }`. `_getLatestForAllGamesImpl` umpleea slot-ul cu placeholder-ul `"abort"` si operatorul vedea "abort" downstream in loc de eroarea reala a sursei. Acum: fetch-ul-eroare ramane mereu raspunsul autoritativ; un esec Mongo ridica doar un WARN log.
- `src/app/lifecycle/events.ts::registerDiscordEvents` ready handler-ul wrap-uieste acum `startHousekeeping()` si `scheduleNextCron()` in try/catch. Inainte, un throw sincron din oricare bubble-uia la discord.js EventEmitter ca `unhandledRejection` — bot-ul ramanea logged-in la Discord dar fara cron si fara housekeeping (stare zombie greu de spotat). Acum emitem ERROR log + `adminAlert("boot:housekeeping" | "boot:cron", ...)` ca operatorul sa stie ca bot-ul a pornit partial.

## Organizarea pe functionalitati

Structura noua pentru zona de comenzi este:

- `src/features/command-registry/commandRegistry.ts`: wiring-ul principal al comenzilor si validarea functiilor asteptate.
- `src/features/command-runtime/commandRuntimeContext.ts`: contextul runtime construit din Mongo, logger, Discord helpers, cache si metrics.
- `src/features/command-cache/commandCache.ts`: cache-ul folosit de comenzi.
- `src/features/command-presentation/commandPresentation.ts`: embed-uri, paginare, select menus si raspunsuri UI.
- `src/features/command-definitions/slashCommandDefinitions.ts`: definitiile slash command.
- `src/features/command-security/adminPermissionGuard.ts`: helper-ul runtime de permisiuni admin.
- `src/features/command-security/adminCommandRouterGuard.ts`: wrapper-ul de securitate pentru comenzile admin.
- `src/features/command-handlers/helpInteractionHandler.ts`: handler-ul `/help`.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts`: handler-ele `/start` si `/stop`.
- `src/features/command-handlers/gameFilterHandlers.ts`: handler-ele `/set games`.
- `src/features/command-handlers/rolePingHandlers.ts`: handler-ele `/set role`.
- `src/features/command-router/legacyInteractionRouter.ts`: routerul ramas pentru `/latest`, `/dlc`, `/status` si autocomplete.

Fisierele vechi plate din `src/features/commands/` au fost eliminate sau mutate in foldere functionale. Partea legacy exista inca, dar este localizata in `command-router`, nu intr-un folder generic ramas din structura veche.

## Reducerea treptata a ctx legacy

Codul inca are module CommonJS care ataseaza functii pe un context comun. Directia corecta este migrarea treptata spre servicii/factory-uri tipate. Pasi deja facuti:

- `src/features/command-registry/commandRegistry.ts` expune `createCommandRegistry(baseContext, installers)` pentru installer-e injectate explicit.
- `src/features/command-security/adminCommandRouterGuard.ts` este un wrapper exterior pentru comenzile admin si foloseste `adminPermissionGuard` inainte de delegare.
- `src/features/command-handlers/helpInteractionHandler.ts` expune `createHelpHandler(deps)` si intercepteaza doar `/help`.
- `src/features/command-handlers/subscriptionNotificationHandlers.ts` expune `createSubscriptionInteractionHandlers(deps)` si un installer care intercepteaza comenzile `/start` si `/stop`.
- `src/features/command-handlers/gameFilterHandlers.ts` expune `createGameFilterInteractionHandlers(deps)` si un installer care intercepteaza doar `/set games`.
- `src/features/command-handlers/rolePingHandlers.ts` expune `createRolePingInteractionHandlers(deps)` si un installer care intercepteaza doar `/set role`.
- `src/sources/sourceRegistry.ts` expune `createSourceRegistry(baseContext, installers)` pentru surse injectate explicit.
- `src/domain/deals/filtersCore.ts` expune functii pure si tipate direct.
- `src/domain/deals/filters.ts` ramane doar adapter pentru contextul legacy.
- `src/features/notifications/outboundChannel.ts` expune resolver-ul de canal Discord ca serviciu tipat.
- `src/features/notifications/index.ts` foloseste `createOutboundChannelResolver`, dar pastreaza adapter-ul legacy pe `ctx`.

Urmatoarele zone bune de refactorizat sunt restul din `src/features/command-router/legacyInteractionRouter.ts` (`latest`, `dlc`, `status`, autocomplete) si persistenta din `src/features/notifications/index.ts`, in pasi separati si cu teste functionale langa fiecare extragere.

## Dependinte npm si supply chain

- Runtime dependencies si build/dev dependencies directe din `src/package.json` sunt versiuni exacte.
- `src/package-lock.json` ramane sursa de instalare reproductibila prin `npm ci`.
- `npm run check:dependencies` pica daca runtime/dev deps directe nu sunt exacte, daca intrarile directe din lockfile nu rezolva la versiunile asteptate sau daca o intrare de lockfile vine din alta sursa decat registry npm peste HTTPS.
- `Dependency Review` verifica PR-urile inainte de merge si completeaza auditul saptamanal. Cand Dependency graph este activ in setarile repo-ului, review-ul este blocant.
- Dependabot ramane util, dar PR-urile lui trebuie citite, nu acceptate automat.

## Build, CI si release

- `src/package.json` separa build Rust, build TypeScript, start, dev, typecheck, strict, test, audit si dependency check.
- `.github/workflows/ci.yml` ruleaza `npm run check` in `src` cu Node.js 20 si Rust stable.
- `.github/workflows/dependency-audit.yml` ruleaza audit runtime saptamanal.
- `.github/workflows/dependency-review.yml` ruleaza review pe PR-uri cu dependency/workflow changes.
- `.github/workflows/codeql.yml` ruleaza CodeQL pentru JavaScript/TypeScript.
- `.github/workflows/release.yml` ruleaza `npm run check`, genereaza `release-notes.md` din sectiunea tag-ului curent, construieste Dockerfile-ul, publica imaginea in GHCR si creeaza GitHub Release.
- Un release real devine vizibil dupa ce `main` primeste un tag semver, de exemplu `v1.0.0` pentru primul release public.

## Acoperire de teste

- `src/test/adminGuard.test.ts` verifica helper-ul de runtime admin si wrapper-ul care blocheaza comenzile admin inainte de delegare.
- `src/test/helpHandler.functional.test.ts` verifica handler-ul extras pentru `/help` si wrapper-ul care deleaga comenzile non-help.
- `src/test/extractReleaseNotes.test.ts` verifica extragerea notelor de release pentru tag-ul curent.
- `src/test/rolePingInteractions.functional.test.ts` verifica factory-ul explicit pentru `/set role` si wrapper-ul care deleaga comenzile non-role.
- `src/test/gameFilterInteractions.functional.test.ts` verifica factory-ul explicit pentru `/set games` si wrapper-ul care deleaga comenzile non-game-filter.
- `src/test/subscriptionInteractions.functional.test.ts` verifica factory-ul explicit pentru `/start`/`/stop` si wrapper-ul instalat in command context.
- `src/test/startUpdatesFlow.e2e.test.ts` verifica fluxul complet `/start updates`, baseline-ul Mongo, cron-ul, trimiterea embed-ului si marcarea `seen`.
- `src/test/startDiscountsFlow.e2e.test.ts` verifica fluxul complet `/start reduceri`, baseline-ul reducerilor, cron-ul, trimiterea embed-ului si marcarea `seenDiscounts`.
- `src/test/sourceRegistry.functional.test.ts`, `src/test/commandRegistry.functional.test.ts`, `src/test/dealFiltersCore.functional.test.ts`, `src/test/httpClientSecurity.test.ts`, `src/test/resolveOutboundChannel.test.ts` si restul testelor raman guard-uri pentru modulele stabilizate.

## Limita verificarii automate

CI si testele E2E locale confirma fluxurile cu mock-uri si DB controlat. Comportamentul live complet necesita un server Discord de staging, token real, Mongo si surse externe reale; aceasta verificare nu trebuie simulata prin secrete puse in repo sau in loguri publice.

## Ce nu am copiat 1:1

Fisierele locale mari au fost tratate ca sursa de idei, nu copiate ca fisiere noi. Repo-ul ramane impartit pe functionalitati, iar fisierele noi din radacina sunt documentatie, exemple vizuale sau infrastructura de rulare/verificare.
