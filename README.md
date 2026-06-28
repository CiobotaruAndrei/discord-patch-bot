# Discord Patch Bot

[![CI](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml)
[![Dependency Audit](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-review.yml)
![Node](https://img.shields.io/badge/node-20.x-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-strict%20global-3178c6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/docker-GHCR%20ready-2496ed?logo=docker&logoColor=white)

Bot Discord pentru notificari despre update-uri, DLC-uri, reduceri si videoclipuri noi de pe canale YouTube urmarite. Proiectul ruleaza pe Node.js/TypeScript, foloseste MongoDB pentru persistenta si include guard-uri pentru scraping fragil, rate limiting, health checks, metrics si deployment cu Docker.

## Ce face botul

- Monitorizeaza jocuri configurate per server Discord.
- Trimite notificari pentru update-uri noi si reduceri relevante.
- Urmareste canale YouTube publice prin feed-urile Atom oficiale si posteaza videoclipurile noi intr-un canal Discord configurat.
- Expune comenzi slash pentru abonare, configurare, verificari manuale si status.
- Evita duplicatele prin colectii `seen` persistate in MongoDB pentru update-uri, reduceri si videoclipuri YouTube.
- Are fallback-uri, validare DNS/IP pentru request-uri externe si circuit breaker pentru surse fragile.
- Expune endpoint-uri locale `/healthz` si `/metrics`.

## Comenzi principale

La adaugarea botului pe un server nou, acesta trimite automat un mesaj de bun venit (pe system channel sau primul canal unde poate posta) care ghideaza configurarea: `/start updates`, `/start reduceri`, `/watchlist add`, `/set role updates`, `/help`.

- `/start updates` - activeaza notificarile de update-uri pentru server.
- `/start reduceri` - activeaza notificarile de reduceri pentru server.
- `/stop updates` - dezactiveaza notificarile de update-uri.
- `/stop reduceri` - dezactiveaza notificarile de reduceri.
- `/watchlist show | add | remove | reset` - (admin) afiseaza si gestioneaza jocurile urmarite explicit pe server; `reset` revine la toate jocurile configurate.
- `/set games add`, `/set games remove`, `/set games reset` - (admin) gestioneaza acelasi filtru per-joc prin suprafata veche, fara listare; pentru afisare foloseste `/watchlist show`.
- `/set mode | mindiscount | maxprice | free | paid | currency | stores` - (admin) configurari de afisare/filtrare per-server.
- `/snooze` si `/unsnooze` - (admin) pune temporar pe pauza o comanda existenta, apoi o reporneste manual inainte de expirare daca este nevoie; optiunea `command` are autocomplete ca optiunea `command` din `/help`.
- `/config` - (admin) afiseaza intr-un singur loc setarile curente ale serverului: mod, reduceri minime, pret maxim, free/paid, valuta, magazine, jocuri active, roluri si canale de notificare.
- `/reset-config` - (admin) cu optiunea obligatorie `confirm:true`, reseteaza setarile serverului la valorile implicite. Goleste si lista dead-letter vizibila **si** payload-urile de replay din colectia separata (ca sa nu ramana orfane, la fel ca `/outbox clear-deadletters`); istoricul rapoartelor si al notificarilor deja livrate (`/history`) nu este sters.
- `/admin-alerts set` si `/admin-alerts off` - (admin) configureaza sau dezactiveaza canalul Discord pentru alerte operationale, dead-letter, permisiuni si rapoarte noi.
- `/price-alert add`, `/price-alert remove` si `/price-alert list` - (admin) gestioneaza alerte de pret. Alerta se trimite pe canalul activat prin `/start reduceri`, se declanseaza o singura data cand pretul ajunge la/sub prag si se rearmeaza fie cand pretul urca peste prag, fie cand jocul lipseste din feed-ul de reduceri `PRICE_ALERT_REARM_ABSENT_CYCLES` cicluri la rand (oferta s-a terminat si jocul a iesit din feed); rearmarea pe absenta nu se face pe esec de fetch al surselor.
- `/youtube subscribe`, `/youtube unsubscribe` si `/youtube list` - (admin) gestioneaza canalele YouTube publice urmarite; adaugarea accepta link, handle `@nume` sau channel ID si pastreaza eligibile numai videoclipurile din ultima luna pentru prima activare.
- `/youtube notify channel`, `/youtube notify on`, `/youtube notify off` si `/youtube notify status` - (admin) configureaza canalul Discord si porneste/opreste postarile automate fara sa stearga abonamentele.
- `/youtube filter shorts`, `/youtube filter lives`, `/youtube filter premieres`, `/youtube filter min-duration` si `/youtube filter status` - (admin) controleaza ce tipuri de videoclipuri pot fi postate.
- `/youtube message-template set`, `/youtube message-template reset`, `/youtube message-template status`, `/youtube channel-route add`, `/youtube channel-route remove`, `/youtube channel-route list`, `/youtube title-filter add`, `/youtube title-filter remove`, `/youtube title-filter list` si `/youtube title-filter clear` - (admin) personalizeaza mesajul, ruteaza separat creatorii (maximum 5 canale Discord per canal YouTube, limita aplicata atat la `channel-route add` cat si defensiv la livrare, ca sa fie marginit fanout-ul chiar si pe date vechi) si permite numai titlurile care contin cel putin una dintre valorile configurate.
- `/youtube videos show` - (admin) posteaza manual videoclipurile din ultima luna. Implicit, videoclipurile cu destinatie pe care le afiseaza sunt marcate ca vazute (claim), deci o **a doua rulare nu le mai reposteaza** (fara duplicate, iar fluxul automat nu le retrimite); foloseste optiunea `repeta:true` ca sa repostezi tot, indiferent de claim. Posteaza doar videoclipurile care au un canal de destinatie (canal principal sau ruta) si raporteaza cate au fost sarite. Necesita macar o destinatie configurata (`/youtube notify channel` sau o ruta), altfel raspunde clar. Daca livrarea unui videoclip esueaza, claim-ul lui e anulat (rollback), ca sa poata fi reincercat. Primul lot (maximum 5) se posteaza **imediat**, iar restul in loturi de cate 5 la interval de 10 minute. Cand outbox-ul e activ (`NOTIFICATION_OUTBOX_ENABLED=true`), restul se enqueue-uiesc imediat (esalonate prin `availableAt`), ca sa supravietuiasca unui restart, iar mesajul confirma durabilitatea; cand outbox-ul e dezactivat, restul se livreaza direct in fundal, iar mesajul spune onest ca **nu** sunt durabile la restart.
- `/youtube status`, `/youtube errors`, `/youtube permissions` si `/youtube clear-errors` - (admin) ofera diagnoza completa pentru monitorizarea YouTube.
- `/latest updates` / `/latest reduceri` - cele mai recente update-uri / reduceri pentru server; `/latest update` si `/latest pret` pentru un joc anume (cu optiunea `joc`).
- `/dlc` - afiseaza DLC-uri cunoscute.
- `/status <joc>` - verifica starea serverelor unui joc (ex. online/mentenanta), nu starea botului; pentru starea botului foloseste `/health`.
- `/history <tip> <numar>` - afiseaza ultimele notificari (update-uri/reduceri/YouTube) livrate efectiv pe acest server, cu link si timestamp relativ; raspuns ephemeral. Istoricul se scrie dupa send-ul real catre Discord; cu outbox-ul activ, intrarile calatoresc pe job si se scriu abia cand worker-ul livreaza mesajul din coada (nu la enqueue), deci o notificare aflata inca in coada sau esuata nu apare in `/history`.
- `/report submit <tip> <detalii> <joc> | list | resolve <id>` - raporteaza o problema, listeaza ultimele rapoarte sau marcheaza un raport ca rezolvat; `list` si `resolve` cer Administrator la runtime.
- `/health` - (admin) starea botului (Discord, MongoDB, cache, uptime); raspuns ephemeral, restrictionat la Administrator fiindca expune stare interna a infrastructurii. Restrictia e dubla (defense-in-depth): permisiunea slash declarata in Discord **plus** guard-ul runtime din `adminCommandRouterGuard` (lista `ADMIN_COMMANDS`). Pentru metrici detaliate (surse, coada outbox, cron) vezi endpoint-ul de metrics.
- `/sources status` - (admin) afiseaza starea ultimelor snapshot-uri de surse externe: Steam/Epic, feed-uri de update pe joc si varsta ultimei verificari persistate.
- `/help` - afiseaza meniul general de ajutor; optiunea `command` intoarce ephemeral explicatia detaliata pentru o comanda exacta, cu autocomplete pe comenzile existente.
- `/set outbox-recovery-verify <on|off>` - (admin) comuta recovery-verify per-server; la `on` avertizeaza daca botului ii lipseste permisiunea Read Message History pe canalele de notificari.
- `/outbox status | deadletters | clear-deadletters | replay-deadletters | retry | drain-now | pause | resume | permissions | recovery-verify status` - (admin) operarea outbox-ului: coada (per-server + global), dead-letter (listare, re-trimitere prin replay dupa remediere, golire dupa investigare), reprogramare livrari, drenare imediata (daca drenarea nu e pe pauza si lock-ul e liber), pauza/reluare drenare (global), audit de permisiuni pe canale si starea recovery-verify.

Comenzile administrative sunt validate atat prin permisiunile slash command declarate in Discord, cat si prin verificari runtime in handler-ele sensibile. La `/start updates` / `/start reduceri`, daca botul nu poate posta pe canal, mesajul de eroare listeaza **exact** ce permisiuni ii lipsesc pe acel canal (dintre **View Channel**, **Send Messages**, **Embed Links**) in loc de un mesaj generic, ca adminul sa stie precis ce sa adauge.

## Cerinte

- Node.js 20.x
- npm 10+
- MongoDB 7+ sau Docker Compose
- Token Discord si aplicatie Discord configurata cu slash commands

## Setup rapid

```bash
cd src
npm ci
cp .env.example .env
npm run build
npm run start:local
```

`npm run start:local` incarca `.env` prin `node --env-file` (botul citeste doar `process.env` — nu exista dotenv). `npm start` (`node dist/app/main.js`) NU incarca `.env`. Imaginea Docker nu ruleaza `npm start`: CMD-ul din `Dockerfile` porneste direct `node dist/app/main.js` (iar `npm`/`npx` sunt sterse din imaginea finala), deci nici acolo nu se incarca `.env` — containerul primeste variabilele prin `env_file` din `docker-compose.yml`, iar in productie vin din mediul orchestratorului.

Pentru development local cu MongoDB inclus:

```bash
docker compose up --build
```

MongoDB ruleaza doar in reteaua interna Docker; botul se conecteaza prin `MONGO_URI`.

## Variabile de mediu

Fisierul `src/.env.example` documenteaza variabilele importante. Cele minime pentru rulare sunt:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
MONGO_URI=mongodb://mongo:27017/discord-patch-bot
```

Variabile utile suplimentare:

- `DISCORD_DEV_GUILD_ID` - optional, pentru comenzi guild-scoped in development.
- `PORT` - portul serverului local de health/metrics.
- `METRICS_TOKEN` - token optional pentru acces la `/metrics`.
- `METRICS_PUBLIC` - permite metrics fara token **doar in dev/local**; in productie e ignorat (METRICS_TOKEN e obligatoriu, altfel boot-ul pica).
- `LOG_LEVEL` - nivelul de logging.
- `PROXY_URLS` - proxy-uri HTTP optionale (template cu `{url}`) pentru surse externe; setarea lor inseamna opt-in explicit.
- `ALLOW_DEFAULT_PROXIES` - proxy-urile implicite third-party (allorigins/codetabs) sunt active doar in `NODE_ENV=development`; in alte medii non-productie (ex. staging) seteaza `ALLOW_DEFAULT_PROXIES=true` ca sa le activezi (altfel raman oprite, ca sa nu scurga URL-uri tinta). In productie raman mereu dezactivate.
- `TRUST_PROXY` / `TRUSTED_PROXY_COUNT` - cand botul ruleaza in spatele unui reverse proxy/LB, seteaza `TRUST_PROXY=true` ca rate limiter-ul sa ia IP-ul clientului din `X-Forwarded-For`. `TRUSTED_PROXY_COUNT` (implicit `1`) = cate proxy-uri trusted ai in fata botului; IP-ul clientului e al **`TRUSTED_PROXY_COUNT`-lea IP numarand de la dreapta** din `X-Forwarded-For` (`segments[length - TRUSTED_PROXY_COUNT]`) — adica IP-ul inregistrat de proxy-ul tau cel mai din exterior (acelasi model ca `trust proxy = N` din Express/`proxy-addr`). Intrarile mai din stanga sunt puse de client si sunt **ignorate** (anti-spoof). Pentru un singur reverse proxy/LB lasa `1` (XFF are doar IP-ul real al clientului, adaugat de proxy); mareste-l (ex. `2` pentru `CDN -> LB -> bot`) ca toti clientii din spatele aceluiasi proxy sa NU fie grupati pe acelasi IP. Un lant XFF mai scurt decat valoarea cade pe IP-ul socket-ului (anti-truncare).
- `ALLOW_NATIVE_FALLBACK` - in `NODE_ENV=production`, addon-ul Rust e obligatoriu si lipsa lui opreste boot-ul (fail-fast), fiindca fallback-ul TypeScript poate produce hash-uri divergente -> spam de notificari. Seteaza `ALLOW_NATIVE_FALLBACK=true` doar daca accepti explicit rularea pe fallback TS in productie.
- `MIGRATIONS_CONTINUE_ON_ERROR` - migrarile DB ruleaza la boot; implicit o migrare esuata este fatala (fail-fast), deci botul nu porneste cu o schema inconsistenta (ex. lipsa indexului unic de dedupe -> notificari duplicate), iar repornirea orchestratorului reincearca migrarea. Cand **alta instanta** tine deja lock-ul de migrari, instanta curenta nu mai sare peste boot orbeste, ci **asteapta** pana cand `migrationState.lastApplied` ajunge la ultima migrare (schema sincronizata) si abia apoi continua; daca nu se sincronizeaza intr-un timeout (lock TTL + 1 min), porneste fail-fast (nu serveste trafic pe o schema posibil neactualizata). Seteaza `MIGRATIONS_CONTINUE_ON_ERROR=true` doar ca escape hatch de urgenta, pentru a porni oricum peste o migrare esuata sau peste timeout-ul de asteptare (pe propriul risc).
- `ADMIN_WEBHOOK_URL` - webhook optional pentru alerte operationale. Aceleasi embed-uri pot fi livrate per-server intr-un canal Discord configurat cu `/admin-alerts set`; rapoartele utilizatorilor sunt trimise numai serverului lor, iar alertele globale ale botului ajung la toate canalele administrative configurate.
- `NOTIFICATION_OUTBOX_ENABLED` - feature flag optional (implicit `false`). Cand este `true`, cron-ul nu mai trimite notificarile inline, ci le pune ca job-uri in colectia `notificationOutbox`, iar un worker dedicat le draneaza pe propriul interval (rate limit + retry/backoff + dead-letter). Inainte de livrare, worker-ul revalideaza abonarea pe guild/canal; daca verificarea Mongo esueaza, jobul este reprogramat cu backoff in loc sa fie trimis fail-open. Recomandat pe volum mare de notificari sau cand vrei ca trimiterea sa supravietuiasca caderilor Discord; lasa-l oprit pentru deploy-uri mici.
- `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS` - cat de des draneaza worker-ul outbox-ul, independent de ciclul cron (implicit `15000`; min `2000`, max `600000`). Activ doar cand `NOTIFICATION_OUTBOX_ENABLED=true`.
- `NOTIFICATION_OUTBOX_DRAIN_LIMIT` - cate job-uri se draneaza intr-un ciclu (implicit `50`; min `1`, max `1000`). TTL-ul lock-ului de drenare se dimensioneaza automat din aceasta valoare si bugetul de trimitere Discord, deci marirea limitei pastreaza lock-ul valid pe toata durata drenarii.
- `NOTIFICATION_OUTBOX_LOCK_TTL_MS` - override optional pentru TTL-ul lock-ului `outbox_drain` (implicit auto-dimensionat; min `120000`, max `3600000`).
- `NOTIFICATION_OUTBOX_SENT_TTL_HOURS` - cat timp se pastreaza istoricul de livrari (`notificationOutboxSent`) folosit pentru a evita re-trimiterea unui job recuperat dupa un crash (implicit `24`; min `1`, max `168`).
- `NOTIFICATION_OUTBOX_MAX_AGE_MS` - varsta de la care un job ramas nelivrat in coada este mutat in **dead-letter** la urmatoarea drenare, **inainte** ca TTL-ul de 7 zile pe `notificationOutbox.createdAt` sa-l stearga tacut (implicit `6 zile`; min `1h`, max `7 zile`). Da un audit clar (dead-letter cu motiv `expired-near-ttl`) pentru joburi blocate (ex. outbox oprit/pe pauza mult timp), in loc de disparitie silentioasa prin TTL.
- `NOTIFICATION_OUTBOX_RECOVERY_VERIFY` - protectie suplimentara optionala (implicit `false`) pentru fereastra rara `send -> markSent`: cand e `true`, fiecare embed primeste un marker `dedupeKey` in footer, iar un job re-revendicat (`deliveries>1`) verifica intai ultimele mesaje din canal pentru acel marker inainte de a re-trimite. Costa un footer vizibil + un fetch de mesaje Discord la fiecare recovery; lasa-l oprit daca nu ai nevoie. Poate fi suprascris per-guild prin comanda admin `/set outbox-recovery-verify <on|off>` (scrie `outboxRecoveryVerify` in setarile guild-ului). Metrici dedicate la `/metrics`: `bot_outbox_recovery_duplicates_prevented`, `bot_outbox_recovery_history_fetches`, `bot_outbox_recovery_verify_failures`, `bot_outbox_recovery_marker_missing` (fetch reusit dar marker negasit -> re-trimis).
- `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` - cate mesaje recente din canal scaneaza verificarea de recovery pentru marker (implicit `25`; min `5`, max `100`).
- `NOTIFICATION_OUTBOX_RECOVERY_STRICT` - mod strict optional (implicit `false`) pentru recovery-verify: cand fetch-ul de istoric esueaza (nu poate citi mesajele), in loc sa trimita oricum (fail-open), nu trimite, reprogrameaza jobul cu backoff si numara `recoveryFailures` + trimite admin alert (fail-closed). Util pe servere unde duplicatele sunt foarte grave.
- `NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS` - lista (separata prin virgula) de ID-uri de utilizator Discord care sunt **operatori ai botului**, singurii care pot rula `/outbox pause` si `/outbox resume`. Aceste comenzi opresc/reiau drenarea pentru **toate** serverele (operatie globala), deci nu trebuie lasate la indemana oricarui admin de guild. Lista goala (implicit) = comenzile sunt indisponibile (safe-by-default); celelalte subcomenzi `/outbox` raman per-guild si neafectate.
- `GUILD_SEEN_DISCOUNT_TTL_DAYS` - fereastra de deduplicare (zile) pentru setul `guildSeenDiscounts` (hash-urile de reduceri deja notificate per guild). Un index TTL pe `seenAt` expira hash-urile vechi, deci colectia ramane marginita si incarcarea ei la fiecare ciclu (`loadSeenDiscountHashes`) nu creste la nesfarsit (implicit `60`; clamp `30`..`365`). Trebuie tinut confortabil peste durata celui mai lung sale (sezonierele Steam tin ~2 saptamani), ca record-ul de dedup al unui sale activ sa nu expire in timpul lui si sa re-notifice; o reducere identica ce revine dupa fereastra e anuntata din nou. `guildSeenUpdates` **nu** are TTL intentionat: „latest"-ul unui joc poate ramane valid la nesfarsit, deci expirarea lui ar re-notifica jocurile dormante.
- Sanatatea outbox-ului este expusa la `/metrics`: `bot_outbox_sent`, `bot_outbox_retried`, `bot_outbox_dead_lettered`, `bot_outbox_expired` (joburi mutate in dead-letter din cauza varstei, inainte de TTL), `bot_outbox_drains`, `bot_outbox_queue_depth`, `bot_outbox_delivery_ms_total` (latenta cumulata; impreuna cu `bot_outbox_sent` da latenta medie), `bot_outbox_oldest_job_age_seconds` (vechimea celui mai vechi job **DUE**, masurata de cand a devenit eligibil — `now - availableAt`, nu de la `createdAt` — ca un retry/lot programat sa nu para vechi imediat ce devine due; joburile programate in viitor sunt excluse), `bot_outbox_future_scheduled_jobs` (gauge: joburi cu `availableAt > now`, ex. loturi manuale esalonate sau retry-uri cu backoff), `bot_outbox_lock_acquire_failures`, `bot_outbox_pause_check_failures` (citiri ale flagului de pauza care au esuat — worker-ul sare ciclul **fail-closed**, nu drenza pe stare necunoscuta), `bot_outbox_mark_sent_failures` (livrari care nu au putut fi marcate in istoricul de dedupe -> risc de re-trimitere la recovery), `bot_history_write_failures` (livrari reusite a caror scriere in `/history` a esuat -> `/history` poate fi incomplet, dar livrarea NU e afectata; pe calea outbox vine si un admin alert `outbox:history-write`, pe calea directa un WARN log) si `bot_outbox_recovery_verify_enabled_guilds` (gauge: cate servere au recovery-verify activ per-guild), plus `bot_outbox_last_drain_age_seconds` (gauge: secunde de la ultima drenare finalizata — creste cand worker-ul nu drenza, ex. pe pauza, deci semnaleaza metrici invechite). Coada `notificationOutbox` are si un index unic *sparse* pe `dedupeKey`, deci doua joburi pending cu acelasi continut nu pot coexista. Cand o livrare reuseste dar `markSent` esueaza, jobul deja livrat este sters, se scrie audit dead-letter cu motivul `delivered-marksent-failed`, iar drain-ul curent se opreste dupa acel job ca sa nu continue trimiteri noi cat timp istoricul de dedupe este degradat. Cand un drain raporteaza esecuri de citire a istoricului (recovery-verify) sau de marcare, worker-ul trimite si un admin alert (cu cooldown) ca operatorul sa afle proactiv.

## Structura proiectului

```text
src/
  app/
    main.ts                 # entry subtire: cablare deps + apel boot
    appRuntime.ts           # createAppRuntime(deps) -> { start, stop, schedulers }
    scheduler/              # cron, outbox worker, housekeeping
    lifecycle/              # inregistrare event-uri Discord/Mongo si shutdown
    health/httpServer.ts    # /healthz si /metrics
  config/                   # loader si validator pentru config.json
  domain/deals/             # filtre pure pentru deal-uri si pending queues
  features/
    command-cache/          # cache-uri in-memory pentru comenzi
    command-registry/       # instalare module de comenzi
    command-runtime/        # context runtime pentru comenzi
    command-definitions/    # definitii slash commands
    command-presentation/   # embed-uri, paginare si UI Discord
    command-security/       # guard-uri admin runtime
    command-handlers/       # handler-e tipate pentru comenzi si autocomplete
    notifications/          # wiring notificari, outbox si servicii update/reduceri/YouTube
    youtube/                # rezolvare canal, feed Atom, filtre, deduplicare si dispatch YouTube
  infra/
    http/                   # client HTTP, proxy, retry, limitari, DNS/IP guard
    mongo/                  # conexiune, modele, locks, migratii
  shared/                   # tipuri/utilitare comune
  sources/                  # surse Steam/Epic/listing/RSS si registry
  docs/                     # harti de context si functie
  native/                   # optional Rust/N-API pentru operatii hot-path
.github/workflows/          # CI, audit, dependency review, release
```

Nu mai exista un `command-router` activ ca structura curenta. Handler-ele cunoscute sunt in `src/features/command-handlers/`, iar `fallbackInteractionHandler.ts` ramane doar ca fallback de final pentru interactiuni necunoscute sau neacoperite explicit.

## Testare

```bash
cd src
npm test
npm run test:functional
npm run test:e2e
npm run typecheck
npm run check
npm run check:comments
npm run build
npm audit
```

`npm run check` ruleaza si `check:comments` (`scripts/check-no-comments.ts`), care esueaza daca exista comentarii (`//` sau `/* */`) in fisierele sursa `.ts`/`.js`/`.rs`, conform regulii „fara comentarii in cod". Allowlist-ul de exceptii este gol (zero exceptii); rationale-ul subtil de concurenta din `cron.ts` a fost mutat in `src/docs/CONTEXT_REPO_CLEAN.md`.

Regula „fara comentarii" se aplica **doar codului sursa runtime/test** (`.ts`/`.js`/`.rs`). Fisierele care **nu** sunt cod — workflow-urile GitHub Actions (`.yml`), `Dockerfile`, `Markdown`, `JSON` de config — sunt in afara scope-ului si pot purta comentarii explicative (ex. comentariile care explica gate-urile din `release.yml`). Scanner-ul nici nu le citeste (`checkedExtensions` = `.ts`/`.js`/`.rs`).

`npm run check` ruleaza si `check:weakening` (`scripts/check-no-weakening-types.ts`), care **esueaza** daca exista constructii care **slabesc tiparea** in codul sursa (`.ts`/`.js`, inclusiv `src/test/`), conform regulii 2: `any`, `as never`, sau dubla asertiune `as unknown as`. Verificat pe AST (TypeScript), nu pe text, deci nu da fals pozitiv pe string-uri. **NU** sunt interzise `unknown` (tipul top, type-safe, opusul lui `any`) si nici casturile de **narrowing** care ingusteaza din `unknown`/date dinamice la un tip utilizabil (ex. `value as Record<string, unknown>`, `item as DealInfo`, `require(...) as typeof import(...)`) — acelea intaresc tiparea, nu o slabesc. Exceptia regulii 2 este stricta: testele pot contine constructii deliberate care slabesc tiparea doar cand fisierul este in allowlist-ul explicit pentru teste bug-catching, in prezent `src/test/checkNoWeakeningTypes.test.ts`.

Testele acopera zonele importante:

- validare env si configuratie;
- registrul de comenzi si guard-uri anti-regresie;
- handler-e functionale pentru `/help`, `/ping`, `/games`, `/set`, `/watchlist`, `/snooze`, `/unsnooze`, `/outbox`, `/youtube`, `/latest`, `/dlc`, `/status` si autocomplete;
- servicii de notificari pentru update-uri, reduceri si YouTube;
- repository-ul `seen` pentru deduplicare;
- fluxuri E2E pentru update-uri si reduceri, plus teste functionale directe pentru sursa, repository-ul, serviciul si comenzile YouTube;
- parsere, filtre, shape drift pe scrapers, circuit breaker, cooldown-uri si rate limiting;
- integrare pe MongoDB real (`outboxMongoIndex.integration.test.ts`): verifica indexul unic sparse pe `notificationOutbox.dedupeKey`; ruleaza in CI (serviciu `mongo:7`) si local cand `MONGO_URI` indica un Mongo pornit, altfel se auto-sare.
- crash-simulation outbox (`outboxCrashRecovery.functional.test.ts`): send reuseste dar `markSent` nu apuca (crash), iar la repornire recovery-verify previne duplicatul (cu test-contrast care arata duplicatul fara recovery-verify).
- multi-instance pe Mongo real (`outboxMultiInstance.integration.test.ts`): doi workeri dreneaza simultan aceeasi coada si lease-ul atomic garanteaza livrare exact-o-data (zero duplicate); ruleaza in CI / local cu Mongo pornit, altfel se auto-sare.

In CI (`ci.yml`), pe langa `npm run check`, se ruleaza si validarea Rust: `cargo clippy --workspace --all-targets -- -D warnings` si `cargo test -p discord_patch_bot_logic` (teste unitare pe crate-ul pur). `native/` e un workspace Cargo cu doua crate-uri: `native/core/` (`discord_patch_bot_logic`, rlib pur, fara napi — toata logica si testele traiesc aici si ruleaza fara build-ul N-API) si wrapper-ul cdylib `discord_patch_bot_core` (`native/src/lib.rs`, doar conversii `#[napi]` care deleaga la core). Compilarea Rust se face deja prin `napi build` din `npm run build`.

Testele automate (unit/functional/integrare/E2E) nu confirma singure comportamentul live cu un token Discord real si gateway real. Pentru asta exista un smoke de staging **semi-automatizat** plus un checklist manual, complementare:

- `npm run smoke:staging` (`scripts/stagingSmoke.ts`) — proba HTTP a unei instante de staging: `GET /healthz` (asteapta `status: ok`, `mongo: 1`, `discord: ready`) si `GET /metrics` (metrici cheie `bot_*`). Activata de `STAGING_BASE_URL` (+ optional `STAGING_METRICS_TOKEN`); fara ele **esueaza (exit 1, fail-closed)** — skip-ul intentionat cere explicit `ALLOW_STAGING_SMOKE_SKIP=true` (iese 0 si scrie artifact cu `skipped:true`, pe care gate-ul de release oricum il respinge).
- `npm run smoke:staging:discord` (`scripts/stagingDiscordSmoke.ts`) — proba **live Discord** pe un **guild de test**: se autentifica cu token-ul real (token + gateway), verifica prin REST ca slash command-urile sunt inregistrate, verifica permisiunile botului pe canalul de test si — cu `STAGING_DISCORD_SEND_TEST=true` — trimite si sterge un embed real (notificare end-to-end). Activata de `STAGING_DISCORD_TOKEN` / `STAGING_DISCORD_CLIENT_ID` / `STAGING_TEST_GUILD_ID` / `STAGING_TEST_CHANNEL_ID`; fara ele **esueaza (exit 1, fail-closed)**, cu acelasi opt-out explicit `ALLOW_STAGING_SMOKE_SKIP=true`.
- Workflow-ul `Staging Smoke` (`.github/workflows/staging-smoke.yml`) ruleaza ambele probe saptamanal si la cerere (`workflow_dispatch`), folosind secretele de repo de mai sus.
- Ce nu poate fi automatizat (un utilizator care *tasteaza* slash commands, notificari live pe un ciclu cron real, ping de rol, shutdown) ramane in checklist-ul manual din `STAGING_SMOKE.md`. Inainte de orice release, gate-ul din `RELEASING.md` cere ca ambele (smoke automat + checklist manual) sa fi trecut.

## Build, start si release

Build-ul si start-ul sunt separate:

```bash
cd src
npm run build
npm start
```

`npm start` ruleaza codul deja compilat din `dist/`. In productie, build-ul trebuie facut in CI, Docker image sau pipeline separat.

Workflow-ul de release poate publica un GitHub Release si o imagine Docker pe GitHub Container Registry cand este impins un tag `v*`. Body-ul release-ului vine strict din sectiunea tag-ului din `CHANGELOG.md`, extrasa in `release-notes.md`.

## Docker

```bash
docker compose up --build
```

Imaginea este multi-stage, instaleaza dependintele cu `npm ci`, compileaza proiectul si ruleaza procesul Node ca user non-root.

**Politica de imagini si rebuild (decizie documentata):** imaginile de baza raman pe **tag-uri mutabile** (`node:20-bookworm-slim` si stage-ul de toolchain `rust:1.96.0-slim-bookworm` in `Dockerfile`, `mongo:7` in `docker-compose.yml` si in serviciile CI), NU pe digest-uri pinuite. Toolchain-ul Rust NU se mai instaleaza prin `curl | sh` de pe `sh.rustup.rs` (script remote executat direct la build): vine prin `COPY --from` din imaginea oficiala `rust`, cu versiunea sincronizata cu `src/native/rust-toolchain.toml` (gard in `supplyChainConfig.test.ts`). Motivatia: un digest pinuit ingheata si patch-urile de securitate pe care maintainer-ii le republica sub acelasi tag (digestul "putrezeste"), iar repo-ul nu are ecosistemul `docker` in Dependabot care sa-l improspateze automat — pin-ul ar schimba un risc teoretic de supply chain cu un risc real de baza neactualizata. Compensatiile active: (1) `apt-get upgrade -y` in stage-ul de runtime aduce patch-urile distro la fiecare build; (2) scanarea **Trivy blocanta** (CRITICAL/HIGH, `exit-code 1`) ruleaza pe imaginea construita la fiecare push relevant pe `main`, saptamanal (cron) si manual (`container-scan.yml`); (3) imaginea publicata pe GHCR la release e identificata imutabil prin tag-ul semver propriu (`vX.Y.Z`), deci reproducerea unui release inseamna a folosi imaginea publicata, nu a reconstrui baza. Rebuild-ul imaginii se face la fiecare release si oricand `Dockerfile`/dependintele se schimba; daca scanarea saptamanala pica, remedierea e un rebuild (care preia baza si patch-urile curente), nu un bump de digest.

## Note arhitecturale

Migrarea dintr-un stil vechi CommonJS/context comun spre handler-e si servicii cu dependinte explicite este **finalizata la nivel de factory-uri**: fiecare modul are un factory `createX(deps: XDeps): XApi` cu dependinte explicit tipate (fara `[key: string]: unknown` sau `& Record<string, unknown>` pe **contractul de input al factory-ului**), iar adaptoarele `attachX(target)` raman doar un strat subtire de compatibilitate la marginea sistemului care construieste obiectul `deps` tipat din contextul de wiring. La boot, `appRuntime` injecteaza dependintele prin contracte explicit tipate: `CommandRuntime`/`ScraperRuntime` pentru runtime-ul de comenzi si surse, iar factory-urile centrale (`createCronController`, `createOutboxWorker`, `createHttpServer`, `createHousekeeping`, `registerDiscordEvents`/`registerMongoEvents`, `createShutdownController`) primesc tipurile reale de deps exportate de modulele lor, cu `env` complet `RuntimeEnv` (gard compile-time in `appRuntimeTypedDeps.test.ts`).

Granitele tiparii — ce ramane intentionat mai lax (ca afirmatiile de mai sus sa fie verificabile, nu doar optimiste): (1) **adaptoarele `attachX(target: XDeps & Record<string, unknown>)`** accepta inca punga de context pe **input-ul de compatibilitate** (nu pe deps-ul factory-ului) — e marginea sistemului, planificata sa dispara odata cu adaptoarele; (2) `commandRegistry` se compune acum **imutabil** prin `createAppServices` (fiecare zona obtinuta prin spread in obiecte noi, fara mutatie in-place a unui `base` partajat), are un **contract de export inchis** (`RequiredCommandRegistry`) verificat de `tsc`, iar registrul public returnat e `Object.freeze`-uit; `sourceRegistry` inca compune prin factory-return `Object.assign(context, attachX.buildFrom(context))` (ordonat) — marginea ramasa, planificata sa fie aliniata; boundary-ul dinamic `installers: unknown[]` a fost eliminat din ambele; (3) **payload-urile dinamice** (raspunsuri de API extern, `Schema.Types.Mixed`, datele dintre handler-e si embed builders) sunt tipate `unknown` si ingustate la consum — `unknown` e alegerea sigura aici, nu o lipsa; (4) restul `Record<string, unknown>` din handler-e sunt obiecte de date construite local (embed-uri, optiuni), nu contracte de dependinte. Modelele Mongo din `mongoContext` au tipuri de document dedicate (`infra/mongo/modelTypes.ts`, gard in `mongoContextTypedApi.test.ts`); in tot codul runtime nu mai exista `: any` (verificabil cu `grep -rn ": any" --include="*.ts"` pe directoarele runtime).

Starea curenta:

- handler-ele pentru comenzi cunoscute sunt separate in `src/features/command-handlers/`;
- routing-ul interactiunilor e o **lista tipata `CommandHandler[]`** compusa in `commandRegistry`: fiecare handler expune `buildCommandHandler(ctx): CommandHandler` (`{ canHandle, handle }`), iar `dispatchCommand` itereaza lista si deleaga la primul `canHandle` adevarat (fallback-ul, mereu `canHandle: () => true`, e ultimul); comenzile admin (`start`/`stop`/`set`/`watchlist`/`snooze`/`unsnooze`/`outbox`/`health`/`config`/`reset-config`/`admin-alerts`/`price-alert`/`youtube`/`sources`) trec intai printr-un pre-check `requireGuildAdmin`, apoi comenzile snoozed trec prin `commandSnoozeGuard` inainte de dispatcher; nu mai exista lantul de `attachX` care impacheteaza `handleInteraction` si nici un fisier `interactions.ts` separat;
- `notifications/index.ts` este wiring pentru cron jobs, iar logica principala este in `updateNotificationService.ts` si `discountNotificationService.ts`;
- toate modulele expun factory-uri cu deps explicit tipate: handler-ele de comenzi, `commandCache.ts`, `commandPresentation.ts`, `mongoContext.ts`, sursele `steam`/`deals`/`updates` (`createSteamSource`/`createDeals`/`createUpdates`) si `notifications/index.ts` (`createNotificationRuntime`); adaptorul `attachX(target)` construieste obiectul `deps` din campurile numite ale contextului (snapshot), nu mai paseaza punga de context;
- `domain/deals/filtersCore.ts`, `outboundChannel.ts` si `seenRepository.ts` sunt module tipate, usor de testat separat;
- `src/native/` contine Rust/N-API folosit pe calea de productie pentru hot-path-urile unde Rust e masurat mai rapid (vezi `BENCHMARKS.md`): hash-urile de dedupe (`dealHash`/`stableUpdateId`), distanta `levenshtein`, normalizarea/curatarea de text, clasificarea de patch notes, scoringul candidatilor de listing, filtrarea URL-urilor de articole Steam si scoringul de data. `findGameKeys` (fuzzy matching), `buildAutocompleteChoices` (autocomplete scoring) si `dealPassesFilters` (filtrarea ofertelor) sunt acum **TS-primary** (masurat mai rapid in TS din cauza marshaling-ului NAPI / calcul trivial); functiile native echivalente raman expuse doar pentru benchmark si testele de paritate, nu pe calea de productie;
- TypeScript-ul strict e **global**: `src/tsconfig.json` are `strict: true` peste tot codul (migrarea incrementala prin `tsconfig.strict.json` s-a incheiat si fisierul a fost eliminat — `npm run typecheck` e sursa unica de adevar);
- `legacy-dynamic.d.ts` a fost eliminat; tipurile trebuie rezolvate local, nu prin extinderea globala a `Object`.
- codul runtime din `app`, `domain`, `features`, `infra`, `shared` si `sources` nu mai contine `: any` si nici abrevierea legacy de context; zonele `unknown`/`Record<string, unknown>` ramase sunt cele enumerate la "granitele tiparii" de mai sus (adaptoare de compatibilitate, bag-ul de wiring, payload-uri dinamice), nu contracte de factory.
- fisierele de cod sunt tinute fara comentarii explicative; contextul de arhitectura, operare si mentenanta sta in README, changelog si `src/docs/`.

Singurele `[key: string]: unknown` / `& Record<string, unknown>` ramase sunt **intentionate** si nu sunt contracte de input de factory: tipurile de date dinamice (`types.ts`), schema Mongo (`infra/mongo/models.ts`) si adaptoarele de compatibilitate care citesc date dinamice si le ingusteaza local. `commandRegistry.ts` nu mai foloseste nici `LegacyInstallerTarget`, nici mecanismul de installers dinamici: compune explicit prin factory-uri reale tipate (`createCommandCache`, `createCommandPresentation`, `createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) compuse **imutabil** intr-un `createAppServices` (fiecare zona prin spread in obiecte noi, fara `Object.assign(base, ...)` pe un singur obiect mutat; registrul public returnat e `Object.freeze`-uit), plus o **lista tipata `CommandHandler[]`** (din `attachX.buildCommandHandler(ctx)`) rutata de `dispatchCommand` (loop `canHandle`/`handle`, fallback ultimul), cu pre-check-ul admin ca singur wrapper, si intoarce contractul inchis `RequiredCommandRegistry` (verificat de `tsc`, nu de un boundary `unknown[]`). Detalii si exceptii in `src/docs/CONTEXT_REPO_CLEAN.md`.

Ambele registre de wiring compun acum **explicit** (apeluri ordonate, fara `installers`/`SourceInstaller[]` dinamici si fara apel printr-un array mutabil), iar **granita de export** e contractata si validata fail-fast, ca sa nu se mai poata pierde tacut o dependinta (clasa de bug care a rupt complet outbox-ul cand `NotificationOutboxSentModel` lipsea din export): `buildMongoContextExports` pastreaza un contract explicit de chei, iar `buildSourceRegistry` extrage fiecare export prin `requireSourceValue`, deci o cheie lipsa produce eroare clara la boot. `commandRegistry` compune explicit factory-urile tipate si cere fiecare functie adaugata de handler-e (`handleInteraction`/`buildHelpEmbed`) prin garda fail-fast `requireInstalled`; `sourceRegistry` (`createSourceRegistry(): SourceRegistryApi`, fara parametri) compune prin **valorile returnate** de `attach*.buildFrom(context)` (factory-return: `Object.assign(context, attachX.buildFrom(context))`), ordonate (`http -> steam -> updates -> deals`), si extrage exportul inchis prin `buildSourceRegistry`/`requireSourceValue`. Fiecare modul de sursa expune un `buildFrom(context)` care **intoarce** contributia, iar `attachX` deleaga la el (`Object.assign(target, buildXFrom(target))`), deci maparea de deps traieste intr-un singur loc. In plus, `assertNoUndefinedExports` (din `shared/assertCompleteExports.ts`) **opreste pornirea (fail-fast)** daca vreun export e `undefined`, in loc sa lase eroarea sa apara mai tarziu la prima folosire. Consecvent cu celelalte fail-fast-uri de boot (migrari, addon nativ).

## Documentatie suplimentara

- `src/docs/CONTEXT_REPO_CLEAN.md` - stare curenta, structura si zone ramase.
- `src/docs/FUNCTION_MAP_CLEAN.md` - harta pe module si responsabilitati.
- `CHANGELOG.md` - schimbari publice.
- `OPERATIONS.md` - runbook de operare (outbox: metrici, alerte, pauza, recovery-verify, setari recomandate).
- `BENCHMARKS.md` - masuratori de performanta + decizii (ce sta in Rust vs TypeScript); ruleaza cu `npm run benchmark:cpu` si `npm run benchmark:outbox`.
- `STAGING_SMOKE.md` - checklist manual de smoke pe un server de staging cu bot Discord real (boot, slash commands, notificari live, outbox, shutdown).
- `RELEASING.md` - gate-ul de release: ce trebuie sa treaca (CI, dependency review, staging smoke automat, manual Discord smoke) inainte de a lansa o versiune.
- `ROADMAP.md` - optimizari amanate cu praguri concrete de declansare (ex. batch-drain outbox).
- `monitoring/` - reguli de alertare Prometheus (`prometheus-alerts.yml`) si dashboard Grafana (`grafana-dashboard.json`) versionate, cu instructiuni in `monitoring/README.md`.
- `SECURITY.md` - raportare vulnerabilitati.

## Securitate

- Nu comita token-uri Discord, URI-uri MongoDB reale sau webhook-uri.
- Foloseste `src/.env.example` ca sablon, nu `src/.env` real.
- Verifica PR-urile Dependabot si lockfile-ul inainte de merge.
- Ruleaza `npm audit` si testele inainte de release.
- Imaginea Docker e scanata cu **Trivy** (vulnerabilitati CRITICAL/HIGH, `ignore-unfixed`) si genereaza un **SBOM CycloneDX** prin workflow-ul `container-scan.yml` (push pe `main` cand se schimba Dockerfile/dependintele, **pe fiecare `pull_request` catre `main`**, saptamanal si manual). Pe PR ruleaza un pas-poarta Trivy cu `exit-code: 1` care **blocheaza merge-ul** daca imaginea are o vulnerabilitate fixabila CRITICAL/HIGH (la fel ca `check`); rezultatele Trivy apar in tab-ul Security (cod scanning, pe push/schedule), iar SBOM-ul e artifact. Completeaza CodeQL + Dependency Review (analiza de cod + dependinte) cu scanarea imaginii (supply chain). La release, imaginea publicata pe GHCR trece prin acelasi gate Trivy blocant **pe imaginea exacta**: build local (fara push), scanare, apoi `docker tag` + `docker push` pe bytes-ii scanati — nu exista cale de publicare nescanata. Tot la release ruleaza si `npm run canary:sources` (canary live pe surse, fail-closed pe API-urile fiabile) pe codul exact al tag-ului.

## Licenta

MIT. Vezi `LICENSE`.
