# Discord Patch Bot

[![CI](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/ci.yml)
[![Dependency Audit](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-review.yml/badge.svg)](https://github.com/CiobotaruAndrei/discord-patch-bot/actions/workflows/dependency-review.yml)
![Node](https://img.shields.io/badge/node-24.x-339933?logo=node.js&logoColor=white)
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

La adaugarea botului pe un server nou, acesta trimite automat un mesaj de bun venit (pe system channel sau primul canal unde poate posta) care ghideaza configurarea: `/start updates`, `/start reduceri`, `/add watchlist`, `/set role updates`, `/help`.

- `/start updates` - activeaza notificarile de update-uri pentru server.
- `/start reduceri` - activeaza notificarile de reduceri pentru server.
- `/start dlc` - configureaza canalul pentru notificarile DLC cand motorul DLC ruleaza in runtime.
- `/start player-count` - (admin) adauga un joc cu Steam appId in lista de player-count a serverului.
- `/stop updates` - dezactiveaza notificarile de update-uri.
- `/stop reduceri` - dezactiveaza notificarile de reduceri.
- `/stop dlc` - opreste notificarile DLC si curata canalul salvat.
- `/stop player-count` - (admin) scoate jocul ales din lista de player-count si opreste modulul cand lista ramane goala.
- `/watchlist show | reset` - (admin) afiseaza si reseteaza jocurile urmarite explicit pe server; `reset` revine la toate jocurile configurate. Adaugarea/scoaterea unui joc se face cu `/add watchlist` si `/remove watchlist`.
- `/set add games`, `/set remove games`, `/set games reset` - (admin) gestioneaza acelasi filtru per-joc prin suprafata veche, fara listare; pentru afisare foloseste `/watchlist show`.
- `/set mode | mindiscount | maxprice | free | paid | currency | stores` - (admin) configurari de afisare si filtrare per-server.
- `/template set | reset | status` si `/notification preview` - (admin) gestioneaza template-urile active pentru update-uri, reduceri si YouTube si permite randarea lor cu date demo fara efecte secundare.
- `/set admin-command-access`, `/admin-command-access list` si `/delete admin-command-access` - (owner-only) configureaza sau sterge regula prin care un rol exact ori un rol egal/mai mare poate folosi comenzi admin pe langa `Administrator` si codul global de acces. Fara `command`, regula este fallback global; cu `command`, regula se aplica doar unei comenzi sau unui pachet precum `/start updates`; pachetele `start`/`stop` pentru acelasi modul folosesc aceeasi regula, deci `/start player-count` acopera automat si `/stop player-count`.
- `/snooze` si `/unsnooze` - (admin) pune temporar pe pauza o comanda existenta, apoi o reporneste manual inainte de expirare daca este nevoie; optiunea `command` are autocomplete ca optiunea `command` din `/help`.
- `/config` - (admin) afiseaza intr-un singur loc setarile curente ale serverului: mod, reduceri minime, pret maxim, free/paid, valuta, magazine, jocuri active, roluri si canale de notificare.
- `/add backup`, `/backup list`, `/backup preview`, `/backup load` si `/backup delete` - (admin) gestioneaza backup-uri ale configuratiei botului pentru server. `load` si `delete` cer `confirm:true`, iar `preview` arata setarile si ID-urile de canale/roluri care vor fi restaurate.
- `/reset-config` - (admin) cu optiunea obligatorie `confirm:true`, reseteaza setarile serverului la valorile implicite si curata starea operationala asociata configuratiei.
- `/admin-alerts set` si `/admin-alerts off` - (admin) configureaza sau dezactiveaza canalul Discord pentru alerte operationale, dead-letter, permisiuni si rapoarte noi.
- `/add price-alert`, `/remove price-alert` si `/price-alert list` - (admin) gestioneaza alerte de pret. Alerta se trimite pe canalul activat prin `/start reduceri`, se declanseaza o singura data cand pretul ajunge la/sub prag si se rearmeaza fie cand pretul urca peste prag, fie cand jocul lipseste din feed-ul de reduceri `PRICE_ALERT_REARM_ABSENT_CYCLES` cicluri la rand (oferta s-a terminat si jocul a iesit din feed); rearmarea pe absenta nu se face pe esec de fetch al surselor.
- `/price-check` - compara pretul Steam al unui joc cu ofertele comparabile din sursele externe de reduceri folosite de bot; pretul Steam este afisat in embed verde.
- `/youtube subscribe`, `/youtube unsubscribe` si `/youtube list` - (admin) gestioneaza canalele YouTube publice urmarite; adaugarea accepta link, handle `@nume` sau channel ID si pastreaza eligibile numai videoclipurile din ultima luna pentru prima activare.
- `/youtube notify channel`, `/youtube notify on`, `/youtube notify off` si `/youtube notify status` - (admin) configureaza canalul Discord si porneste/opreste postarile automate fara sa stearga abonamentele.
- `/youtube filter shorts`, `/youtube filter lives`, `/youtube filter premieres`, `/youtube filter min-duration` si `/youtube filter status` - (admin) controleaza ce tipuri de videoclipuri pot fi postate.
- `/youtube add channel-route`, `/youtube remove channel-route`, `/youtube channel-route list`, `/youtube add title-filter`, `/youtube remove title-filter`, `/youtube title-filter list` si `/youtube title-filter clear` - (admin) ruteaza separat creatorii si permite numai titlurile care contin cel putin una dintre valorile configurate.
- `/youtube status` si `/youtube clear-errors` - (admin) ofera diagnoza si curata erorile memorate pentru monitorizarea YouTube.
- `/latest updates` / `/latest reduceri` - cele mai recente update-uri / reduceri pentru server; `/latest update` si `/latest pret` pentru un joc anume (cu optiunea `joc`).
- `/dlc` - afiseaza DLC-uri cunoscute.
- `/start dlc` / `/stop dlc` - (admin) configureaza sau opreste canalul salvat pentru notificarile DLC automate cand motorul DLC ruleaza in runtime.
- `/game overview`, `/status game` si `/status watchlist` - agrega informatiile principale despre joc si verifica starea serverelor individual sau pentru watchlist, cu esecuri izolate pe surse.
- `/report bug`, `/report complaint`, `/report list bugs`, `/report list users`, `/report remove bug` si `/report remove user` - foloseste formulare pentru bug-uri si reclamatii, colectii separate, deduplicare si administrare separata.
- `/suggest-command`, `/list suggest-command` si `/delete suggest-command` - utilizatorii pot propune comenzi noi, iar adminii pot lista sau sterge propunerile salvate pe server; `/add suggestion` ramane alias compatibil.
- `/watchlist-game add`, `/watchlist-game list` si `/watchlist-game delete` - utilizatorii pot propune jocuri noi pentru bot, iar adminii pot curata lista de propuneri.
- `/future-release add`, `/future-release list`, `/future-release delete`, `/future-release start` si `/future-release stop` - (admin) gestioneaza lista de maxim 20 jocuri care urmeaza sa apara si canalul folosit pentru notificarile future-release.
- `/deal-score` - calculeaza un scor 1-10 pentru o oferta activa folosind reducerea, pretul, semnalele de calitate/popularitate si magazinul.
- `/player-count game | trend | milestone | gainers | peak-time` si `/top active games` - afiseaza valoarea curenta, istoric, recorduri, cresteri si ore de varf pentru jocurile cu Steam appId.
- `/watchlist coverage` si `/game-alias add | remove | list` - (admin) verifica acoperirea surselor si gestioneaza aliasurile locale serverului.
- `/maintenance` - (admin) afiseaza zonele operationale care trebuie verificate: surse cu erori, outbox, dead-letter, backup, canale lipsa si module de notificare oprite.
- `/health` - (admin) starea botului (Discord, MongoDB, cache, uptime); raspuns ephemeral, restrictionat la Administrator fiindca expune stare interna a infrastructurii. Restrictia e dubla (defense-in-depth): permisiunea slash declarata in Discord **plus** guard-ul runtime din `adminCommandRouterGuard` (lista `ADMIN_COMMANDS`). Pentru metrici detaliate (surse, coada outbox, cron) vezi endpoint-ul de metrics.
- `/sources status` - (admin) afiseaza starea ultimelor snapshot-uri de surse externe: Steam/Epic, feed-uri de update pe joc si varsta ultimei verificari persistate, plus un sumar de sanatate al surselor derivat din starea circuit breaker-elor (cate sunt sanatoase / degradate / in cooldown / cu schema-drift suspectat) si lista surselor cu probleme.
- `/help` - afiseaza meniul general de ajutor; optiunea `command` intoarce ephemeral explicatia detaliata pentru o comanda exacta, cu autocomplete pe comenzile existente.
- `/bot-log recent`, `/bot-log older`, `/server-log recent` si `/server-log older` - (admin) afiseaza auditul comenzilor admin si schimbarile importante persistate de bot pentru server, inclusiv cautare pe intervale istorice controlate.

Comenzile administrative sunt validate atat prin permisiunile slash command declarate in Discord, cat si prin verificari runtime. Runtime-ul accepta implicit `Administrator`, apoi regula de rol dedicata comenzii daca ownerul a setat una prin `/set admin-command-access` cu optiunea `command:<comanda>`, apoi fallback-ul global configurat prin `/set admin-command-access` fara `command`, apoi codul global de acces introdus prin modal ephemeral. Pentru modulele cu pereche `start`/`stop`, scope-ul este comun: o regula pusa pe `/start updates`, `/start reduceri`, `/start dlc` sau `/start player-count` se aplica automat si comenzii `/stop` corespunzatoare. Codul global se configureaza preferabil ca hash in `BOT_GLOBAL_ACCESS_CODE_HASH`; `BOT_GLOBAL_ACCESS_CODE` ramane doar fallback de development local sau secret manager. Pana ownerul seteaza o regula de rol, rolurile simple nu dau acces admin; raman valabile doar `Administrator` si codul global corect. Comenzile owner-only accepta ownerul serverului sau codul global corect. Refuzul vizibil este `Access denied.`, iar rezultatele `Access granted.`/`Access denied.` sunt salvate in `/bot-log`. Comenzile sensibile pot cere si user ID in `BOT_SENSITIVE_USER_IDS`; operatiile foarte sensibile folosesc confirmare explicita prin optiune precum `confirm:true`. La `/start updates` / `/start reduceri`, daca botul nu poate posta pe canal, mesajul de eroare listeaza **exact** ce permisiuni ii lipsesc pe acel canal (dintre **View Channel**, **Send Messages**, **Embed Links**) in loc de un mesaj generic, ca adminul sa stie precis ce sa adauge.

## Cerinte

- Node.js 24.x (LTS; require(esm) e necesar pentru module-le ESM emise)
- npm 10+
- MongoDB 7+ sau Docker Compose
- Token Discord si aplicatie Discord configurata cu slash commands

## Setup rapid

```bash
cd src
npm ci
cp .env.example .env
npm run doctor:local
npm run dev
```

`npm run check:env` valideaza mediul primit de proces, iar `npm run check:env:local` incarca automat `.env`. `npm run check:mongo:local` conecteaza baza indicata de `MONGO_URI`, executa un `ping`, afiseaza numele bazei si inchide conexiunea; `npm run check:redis:local` verifica Redis cu acelasi fisier. `npm run doctor:local` compileaza TypeScript o singura data si ruleaza succesiv verificarile pentru `.env`, configuratie, MongoDB si Redis. `npm run dev` face build-ul complet si porneste botul prin `start:local`, deci foloseste automat `.env`.

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
- `BOT_ROLE` - `all` (implicit), `web` sau `worker`. `all` = un singur proces care face tot (comportamentul actual). `web` = doar interactiuni Discord + slash commands + HTTP, fara job-uri de fundal. `worker` = doar job-urile de fundal (cron, drain outbox, housekeeping) + HTTP health/metrics, fara sa trateze interactiuni. Cele doua roluri se pot rula ca procese separate (`npm start` / `npm run start:worker`) si se coordoneaza prin lock-urile DB. Vezi sectiunea [Worker separat](#worker-separat).
- `REDIS_URL` - optional (implicit gol). Cand este setat, botul deschide o conexiune Redis la boot (dupa Mongo, inainte de hidratarea cache-ului) si o inchide curat la shutdown. Cand lipseste, Redis ramane dezactivat si botul porneste normal. Vezi sectiunea [Redis](#redis).
- `PROXY_URLS` - proxy-uri HTTP optionale (template cu `{url}`) pentru surse externe; setarea lor inseamna opt-in explicit.
- `ALLOW_DEFAULT_PROXIES` - proxy-urile implicite third-party (allorigins/codetabs) sunt active doar in `NODE_ENV=development`; in alte medii non-productie (ex. staging) seteaza `ALLOW_DEFAULT_PROXIES=true` ca sa le activezi (altfel raman oprite, ca sa nu scurga URL-uri tinta). In productie raman mereu dezactivate.
- `TRUST_PROXY` / `TRUSTED_PROXY_COUNT` - cand botul ruleaza in spatele unui reverse proxy/LB, seteaza `TRUST_PROXY=true` ca rate limiter-ul sa ia IP-ul clientului din `X-Forwarded-For`. `TRUSTED_PROXY_COUNT` (implicit `1`) = cate proxy-uri trusted ai in fata botului; IP-ul clientului e al **`TRUSTED_PROXY_COUNT`-lea IP numarand de la dreapta** din `X-Forwarded-For` (`segments[length - TRUSTED_PROXY_COUNT]`) — adica IP-ul inregistrat de proxy-ul tau cel mai din exterior (acelasi model ca `trust proxy = N` din Express/`proxy-addr`). Intrarile mai din stanga sunt puse de client si sunt **ignorate** (anti-spoof). Pentru un singur reverse proxy/LB lasa `1` (XFF are doar IP-ul real al clientului, adaugat de proxy); mareste-l (ex. `2` pentru `CDN -> LB -> bot`) ca toti clientii din spatele aceluiasi proxy sa NU fie grupati pe acelasi IP. Un lant XFF mai scurt decat valoarea cade pe IP-ul socket-ului (anti-truncare).
- `ALLOW_NATIVE_FALLBACK` - in `NODE_ENV=production`, addon-ul Rust e obligatoriu si lipsa lui opreste boot-ul (fail-fast), fiindca fallback-ul TypeScript poate produce hash-uri divergente -> spam de notificari. Seteaza `ALLOW_NATIVE_FALLBACK=true` doar daca accepti explicit rularea pe fallback TS in productie.
- `MIGRATIONS_CONTINUE_ON_ERROR` - migrarile DB ruleaza la boot; implicit o migrare esuata este fatala (fail-fast), deci botul nu porneste cu o schema inconsistenta (ex. lipsa indexului unic de dedupe -> notificari duplicate), iar repornirea orchestratorului reincearca migrarea. Cand **alta instanta** tine deja lock-ul de migrari, instanta curenta nu mai sare peste boot orbeste, ci **asteapta** pana cand `migrationState.lastApplied` ajunge la ultima migrare (schema sincronizata) si abia apoi continua; daca nu se sincronizeaza intr-un timeout (lock TTL + 1 min), porneste fail-fast (nu serveste trafic pe o schema posibil neactualizata). Seteaza `MIGRATIONS_CONTINUE_ON_ERROR=true` doar ca escape hatch de urgenta, pentru a porni oricum peste o migrare esuata sau peste timeout-ul de asteptare (pe propriul risc).
- `ADMIN_WEBHOOK_URL` - webhook optional pentru alerte operationale. Aceleasi embed-uri pot fi livrate per-server intr-un canal Discord configurat cu `/admin-alerts set`; rapoartele utilizatorilor sunt trimise numai serverului lor, iar alertele globale ale botului ajung la toate canalele administrative configurate.
- `BOT_GLOBAL_ACCESS_CODE_HASH` - hash SHA-256 al codului global de acces folosit ca fallback runtime pentru comenzi admin si owner-only. Se tine in env/deployment secrets; in repo si `.env.example` ramane doar placeholder-ul `change_me`.
- `BOT_GLOBAL_ACCESS_CODE` - fallback simplu doar pentru development local sau secret manager. Nu se comite niciodata codul real in GitHub.
- `BOT_SENSITIVE_USER_IDS` - lista separata prin virgula de Discord user ID-uri autorizate pentru comenzi sensibile precum `/backup load`, `/backup delete`, `/reset-config` si operatii outbox globale/distructive. Daca lista este goala, ramane doar verificarea de admin.
- `NOTIFICATION_OUTBOX_ENABLED` - feature flag optional (implicit `false`). Cand este `true`, cron-ul nu mai trimite notificarile inline, ci le pune ca job-uri in colectia `notificationOutbox`, iar un worker dedicat le draneaza pe propriul interval (rate limit + retry/backoff + dead-letter). Inainte de livrare, worker-ul revalideaza abonarea pe guild/canal; daca verificarea Mongo esueaza, jobul este reprogramat cu backoff in loc sa fie trimis fail-open. Recomandat pe volum mare de notificari sau cand vrei ca trimiterea sa supravietuiasca caderilor Discord; lasa-l oprit pentru deploy-uri mici.
- `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS` - cat de des draneaza worker-ul outbox-ul, independent de ciclul cron (implicit `15000`; min `2000`, max `600000`). Activ doar cand `NOTIFICATION_OUTBOX_ENABLED=true`.
- `NOTIFICATION_OUTBOX_DRAIN_LIMIT` - cate job-uri se draneaza intr-un ciclu (implicit `50`; min `1`, max `1000`). TTL-ul lock-ului de drenare se dimensioneaza automat din aceasta valoare si bugetul de trimitere Discord, deci marirea limitei pastreaza lock-ul valid pe toata durata drenarii.
- `NOTIFICATION_OUTBOX_LOCK_TTL_MS` - override optional pentru TTL-ul lock-ului `outbox_drain` (implicit auto-dimensionat; min `120000`, max `3600000`).
- `NOTIFICATION_OUTBOX_SENT_TTL_HOURS` - cat timp se pastreaza istoricul de livrari (`notificationOutboxSent`) folosit pentru a evita re-trimiterea unui job recuperat dupa un crash (implicit `24`; min `1`, max `168`).
- `NOTIFICATION_OUTBOX_MAX_AGE_MS` - varsta de la care un job ramas nelivrat in coada este mutat in **dead-letter** la urmatoarea drenare, **inainte** ca TTL-ul de 7 zile pe `notificationOutbox.createdAt` sa-l stearga tacut (implicit `6 zile`; min `1h`, max `7 zile`). Da un audit clar (dead-letter cu motiv `expired-near-ttl`) pentru joburi blocate (ex. outbox oprit/pe pauza mult timp), in loc de disparitie silentioasa prin TTL.
- `NOTIFICATION_OUTBOX_RECOVERY_VERIFY` - protectie suplimentara optionala (implicit `false`) pentru fereastra rara `send -> markSent`: cand e `true`, fiecare embed primeste un marker `dedupeKey` in footer, iar un job re-revendicat verifica intai ultimele mesaje din canal pentru acel marker. Metricile dedicate sunt expuse la `/metrics`.
- `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` - cate mesaje recente din canal scaneaza verificarea de recovery pentru marker (implicit `25`; min `5`, max `100`).
- `NOTIFICATION_OUTBOX_RECOVERY_STRICT` - mod strict optional (implicit `false`) pentru recovery-verify: cand fetch-ul de istoric esueaza (nu poate citi mesajele), in loc sa trimita oricum (fail-open), nu trimite, reprogrameaza jobul cu backoff si numara `recoveryFailures` + trimite admin alert (fail-closed). Util pe servere unde duplicatele sunt foarte grave.
- `NOTIFICATION_OUTBOX_GLOBAL_ADMIN_IDS` - lista separata prin virgula de operatori tehnici pastrata pentru compatibilitatea configuratiei interne a outbox-ului.
- `GUILD_SEEN_DISCOUNT_TTL_DAYS` - fereastra de deduplicare (zile) pentru setul `guildSeenDiscounts` (hash-urile de reduceri deja notificate per guild). Un index TTL pe `seenAt` expira hash-urile vechi, deci colectia ramane marginita si incarcarea ei la fiecare ciclu (`loadSeenDiscountHashes`) nu creste la nesfarsit (implicit `60`; clamp `30`..`365`). Trebuie tinut confortabil peste durata celui mai lung sale (sezonierele Steam tin ~2 saptamani), ca record-ul de dedup al unui sale activ sa nu expire in timpul lui si sa re-notifice; o reducere identica ce revine dupa fereastra e anuntata din nou. `guildSeenUpdates` **nu** are TTL intentionat: „latest"-ul unui joc poate ramane valid la nesfarsit, deci expirarea lui ar re-notifica jocurile dormante.
- `GUILD_AUDIT_LOG_TTL_DAYS` - retentia (zile) a audit-ului admin din colectia `guildAuditLogs` (intrarile `/bot-log` si `/server-log`). Un index TTL pe `at` expira intrarile vechi, inlocuind vechiul cap de 100 de intrari per array de pe documentul guild: intrarile expira dupa timp, nu dupa numar, deci un val de comenzi nu mai poate impinge afara istoricul recent (implicit `180`; clamp `30`..`730`).
- Sanatatea outbox-ului este expusa la `/metrics`, inclusiv livrari, retry-uri, dead-letter, vechimea cozii, erori de lock si verificari recovery. Coada `notificationOutbox` are un index unic sparse pe `dedupeKey`, iar worker-ul ridica alerte administrative pentru degradarile importante.

## Redis

Redis este **optional** momentan si serveste ca fundatie pentru un cache extern / coada de joburi viitoare (BullMQ si un worker separat **nu** sunt inca incluse — acest pas adauga doar conexiunea).

- Fara `REDIS_URL`, botul porneste normal si nu deschide nicio conexiune (`connect()` devine no-op cu un log informativ, iar preflight-ul de env doar avertizeaza).
- Cu `REDIS_URL` setat, clientul se creeaza din URL (`createClient({ url: REDIS_URL })`) si se conecteaza la boot dupa Mongo si inainte de hidratarea cache-ului. Daca URL-ul e setat dar conexiunea esueaza, boot-ul se opreste fail-fast (nu pornim cu o dependenta configurata dar indisponibila).
- La shutdown, conexiunea se inchide cu `quit()` (doar daca e deschisa) dupa oprirea cron/outbox/housekeeping si inainte de inchiderea Mongo/HTTP; o eroare de inchidere e logata ca WARN si nu blocheaza shutdown-ul.
- Comanda `/health` afiseaza statusul Redis pe una dintre starile `⚪ dezactivat` (fara `REDIS_URL`), `🟢 conectat` sau `🔴 deconectat` (`REDIS_URL` setat dar clientul nu e deschis). Statusul e pur informativ — Redis fiind optional, nu marcheaza botul ca degradat.
- `npm run check:redis` verifica rapid conexiunea fara sa porneasca botul: fara `REDIS_URL` raporteaza „dezactivat" si iese cu cod `0`; cu `REDIS_URL` se conecteaza, trimite `PING`, inchide conexiunea si iese cu `0` la succes sau `1` la esec. Cu `.env` local: `node --env-file=.env dist/scripts/check-redis.js`.
- Cand Redis e activ, numararea de jucatori Steam pentru player-count e cache-uita scurt (cheie `player-count:steam:<appId>`, TTL 60s) ca sa nu se reinterogheze Steam pentru acelasi joc de mai multe ori la rand. E best-effort: fara `REDIS_URL` sau la orice eroare de Redis se cade automat pe fetch-ul live (rezultatul comenzii `/player-count` ramane identic), iar Mongo ramane sursa persistenta a snapshot-urilor.
- `/metrics` expune 5 serii Redis (in sistemul de metrici existent, nu Prometheus nou): `bot_redis_connect_success`, `bot_redis_connect_failure`, `bot_redis_cache_hit`, `bot_redis_cache_miss`, `bot_redis_errors`. Fara `REDIS_URL` raman `0` (contoarele nu se incrementeaza cand Redis e dezactivat).

Exemplu `.env` (parola de mai jos este doar un placeholder):

```env
REDIS_URL=redis://default:password@host:port
```

Parola si URL-ul Redis se tin **doar in env / secret manager**, niciodata in cod si niciodata comise pe GitHub. Fisierul local `.env` este in `.gitignore`, iar `src/.env.example` pastreaza doar un placeholder.

## Worker separat

Botul poate rula ca **un singur proces** (implicit) sau impartit in **doua roluri** care ruleaza ca procese separate din aceeasi imagine/cod, controlate de variabila `BOT_ROLE`:

- `all` (implicit) — un proces face tot: interactiuni Discord + slash commands + toate job-urile de fundal (cron update-uri/reduceri/YouTube, drain outbox, housekeeping) + HTTP. **Comportamentul actual, neschimbat.**
- `web` — doar interactiunile Discord (slash commands, onboarding la guild nou) + HTTP. **Nu** porneste niciun job de fundal — graful runtime `web` nici macar nu le construieste (cron controller, outbox worker si housekeeping nu exista in procesul `web`, iar `/healthz` nu are sectiunea `cronHealth`).
- `worker` — doar job-urile de fundal (cron, drain outbox, housekeeping) + HTTP health/metrics. **Nu** inregistreaza slash commands si **nu** trateaza interactiuni.

Rulare:

```bash
# un singur proces (implicit)
npm start                       # BOT_ROLE=all (sau nesetat)

# impartit in doua procese
npm run start:web                # procesul care raspunde la comenzi
npm run start:worker             # procesul de fundal

# aceleasi roluri cu .env incarcat local
npm run start:web:local
npm run start:worker:local
```

Cele doua procese se **coordoneaza prin lock-urile distribuite din MongoDB** (`acquireDbLock`), la fel ca doua instante `all`: cron-ul si drain-ul outbox nu se pot dubla, iar interactiunile sunt tratate doar de `web`. Cand rulezi doua procese pe aceeasi masina, da-le **`PORT` diferit** (fiecare rol expune propriul `/healthz` + `/metrics`).

Nota (un singur bot token): ambele roluri deschid o conexiune la gateway-ul Discord (`worker`-ul are nevoie de client ca sa trimita notificarile). Pentru un bot ne-shardat, varianta cea mai simpla ramane `all` intr-un singur proces; impartirea `web`/`worker` e utila cand vrei sa separi incarcarea, tinand cont ca lock-urile DB previn dublarea job-urilor, iar interactiunile raman doar pe `web`. Sharding-ul propriu-zis ramane un pas ulterior (vezi `docs/architecture/scaling-readiness.md`).

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
    admin-records/          # backup-uri de configuratie, audit admin/server si sugestii comenzi
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
npm run test:e2e
npm run typecheck
npm run lint
npm run check
npm run check:full
npm run build
npm audit
```

Scripturi de conveniența: `npm run check:quick` compileaza TypeScript o singura data, apoi ruleaza direct verificarile de sintaxa si configuratie; `npm run lint` compileaza o singura data si verifica sintaxa, absenta comentariilor si constructiile care slabesc tiparea. `npm run check:full` reutilizeaza build-ul produs de `check` pentru E2E prin `test:e2e:prebuilt`, in timp ce `npm run test:e2e` ramane comanda independenta care isi face propriul build. `npm run test:notifications` ruleaza doar testele de notificari/outbox, `npm run clean` / `npm run rebuild` curata sau reconstruiesc proiectul, iar `npm run audit:strict` esueaza la orice vulnerabilitate.

Pentru operare locala, `npm run doctor:local` verifica intr-un singur flux `.env`, `config.json`, conectivitatea MongoDB si Redis. `npm run db:export:guilds` exporta implicit numai configuratia restaurabila a fiecarui guild si exclude cozile, starile tranzitorii si regulile sensibile de acces. Exportul complet al documentelor Mongo este disponibil numai explicit prin `npm run db:export:guilds:raw`; fisierul brut trebuie tratat ca material sensibil.

### Dependinte native pentru build-ul addon-ului Rust

Addon-ul leaga trei librarii C/C++: **libyara** (motorul de reguli, etapa 2), **libarchive** (decodarea
continutului arhivelor, etapa 3) si **qpdf** (analiza structurala a PDF-urilor, etapa 4). Toate trei sunt
compilate din surse si legate static. libyara si qpdf nu cer niciun pachet de sistem in plus (qpdf are
nevoie doar de un compilator C++17, adus de `build-essential`); libarchive cere un lant de librarii de
compresie prezente la build.

Pe **Linux** (CI si Docker) e suficient apt:

```bash
sudo apt-get install -y --no-install-recommends   cmake clang libclang-dev libssl-dev zlib1g-dev libbz2-dev liblzma-dev libzstd-dev liblz4-dev libxml2-dev libacl1-dev
```

Pe **Windows** (dezvoltare) sunt necesare CMake, LLVM (pentru `libclang`, folosit de bindgen) si vcpkg:

```powershell
winget install Kitware.CMake
winget install LLVM.LLVM
git clone --depth 1 https://github.com/microsoft/vcpkg C:\vcpkg
C:\vcpkg\bootstrap-vcpkg.bat
C:\vcpkg\vcpkg.exe install zlib bzip2 liblzma zstd lz4 openssl --triplet x64-windows
Copy-Item C:\vcpkg\installed\x64-windows\lib\z.lib C:\vcpkg\installed\x64-windows\lib\zlib.lib
```

Apoi variabilele de mediu (utilizator): `VCPKG_INSTALLATION_ROOT=C:\vcpkg`,
`CMAKE_TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake`,
`LIBCLANG_PATH=C:\Program Files\LLVM\bin`, iar `BINDGEN_EXTRA_CLANG_ARGS` trebuie sa contina
`--target=x86_64-pc-windows-msvc -fms-compatibility -fms-extensions` plus cate un `-I` pentru fiecare
director din `%INCLUDE%` al `vcvars64.bat`. `PATH` primeste `C:\Program Files\CMake\bin`,
`C:\Program Files\LLVM\bin` si `C:\vcpkg\installed\x64-windows\bin`.

Trei capcane verificate pe teren:

1. MSBuild refuza sa construiasca sub `%TEMP%` sau pe cai care depasesc 260 de caractere
   (`FTK1011`/`MSB8029`).
2. vcpkg instaleaza zlib ca `z.lib`, in timp ce `libarchive2-sys` cere `zlib.lib` — de aici copierea
   de mai sus.
3. Tripletul `x64-windows` produce librarii **dinamice**, deci `C:\vcpkg\installed\x64-windows\bin` trebuie sa fie in
   `PATH` si **la rulare**, nu doar la build. Fara el `require` pe addon esueaza cu mesajul generic
   napi „Cannot find native binding", care ascunde adevarata cauza (`The specified module could not
   be found` — un DLL de compresie lipsa). Pe Linux nu apare: librariile apt sunt deja pe calea
   loader-ului.

`npm run check` e un orchestrator: compileaza mai intai TypeScript o singura data, construieste addon-ul Rust, apoi deleaga la `npm run check:prebuilt` — varianta care ruleaza toate gate-urile si testele direct pe artefactele existente, fara niciun build. `npm run check:ts-prebuilt` reconstruieste doar TypeScript si refoloseste addon-ul nativ deja construit (iteratie locala rapida pe cod TS). Scriptul `typecheck` ramane disponibil separat pentru verificarea fara emit.

`npm run check` ruleaza si `check:comments` (`scripts/check-no-comments.ts`), care esueaza daca exista comentarii (`//` sau `/* */`) in fisierele sursa `.ts`/`.js`/`.rs`, conform regulii „fara comentarii in cod". Allowlist-ul de exceptii este gol (zero exceptii); rationale-ul subtil de concurenta din `cron.ts` a fost mutat in `docs/architecture/CONTEXT_REPO_CLEAN.md`.

Regula „fara comentarii" se aplica **doar codului sursa runtime/test** (`.ts`/`.js`/`.rs`). Fisierele care **nu** sunt cod — workflow-urile GitHub Actions (`.yml`), `Dockerfile`, `Markdown`, `JSON` de config — sunt in afara scope-ului si pot purta comentarii explicative (ex. comentariile care explica gate-urile din `release.yml`). Scanner-ul nici nu le citeste (`checkedExtensions` = `.ts`/`.js`/`.rs`).

Datoria cunoscuta ramasa (wiring-ul `commandRuntimeDependencies.ts`/`operationJournalRuntime.ts` — Major #2) e intr-un allowlist explicit: orice fisier NOU cu aceeasi problema pica la CI, iar cand datoria se rezolva, intrarea se scoate din allowlist — asa s-a intamplat cu `sources/sourceRegistry.ts` (Major #8, rezolvat: stratul de surse pastreaza doar fabrica si tipurile, instanta traieste in composition root) si cu fostii locatori Redis `infra/redis/redisContext.ts` + `redisCacheContext.ts` (Major #1, felia infra, rezolvat: module sterse, consumatorii iau instantele din `app/runtimeComposition.ts`); allowlist-urile `infra -> app` si `sources -> app` sunt GOALE.

`npm run check` ruleaza si `check:weakening` (`scripts/check-no-weakening-types.ts`), care **esueaza** daca exista constructii care **slabesc tiparea** in codul sursa (`.ts`/`.js`, inclusiv `src/test/`), conform regulii 2: `any`, `as never`, sau dubla asertiune `as unknown as`. Verificat pe AST (TypeScript), nu pe text, deci nu da fals pozitiv pe string-uri. **NU** sunt interzise `unknown` (tipul top, type-safe, opusul lui `any`) si nici casturile de **narrowing** care ingusteaza din `unknown`/date dinamice la un tip utilizabil (ex. `value as Record<string, unknown>`, `item as DealInfo`, `require(...) as typeof import(...)`) — acelea intaresc tiparea, nu o slabesc. Exceptia regulii 2 este stricta: testele pot contine constructii deliberate care slabesc tiparea doar cand fisierul este in allowlist-ul explicit pentru teste bug-catching, in prezent `src/test/checkNoWeakeningTypes.test.ts`.

Testele acopera zonele importante:

- validare env si configuratie;
- registrul de comenzi si guard-uri anti-regresie;
- handler-e functionale pentru `/help`, `/ping`, `/games`, `/set`, `/template`, `/notification`, `/watchlist`, `/game-alias`, `/snooze`, `/unsnooze`, `/backup`, `/bot-log`, `/server-log`, `/price-check`, `/deal-score`, `/game`, `/player-count`, `/report`, `/youtube`, `/latest`, `/dlc`, `/status` si autocomplete;
- servicii de notificari pentru update-uri, reduceri si YouTube;
- repository-ul `seen` pentru deduplicare;
- fluxuri E2E pentru update-uri si reduceri, plus teste functionale directe pentru sursa, repository-ul, serviciul si comenzile YouTube;
- parsere, filtre, shape drift pe scrapers, circuit breaker, cooldown-uri si rate limiting;
- integrare pe MongoDB real (`outboxMongoIndex.integration.test.ts`): verifica indexul unic sparse pe `notificationOutbox.dedupeKey`; ruleaza in CI (serviciu `mongo:7`) si local cand `MONGO_URI` indica un Mongo pornit, altfel se auto-sare.
- crash-simulation outbox (`outboxCrashRecovery.functional.test.ts`): send reuseste dar `markSent` nu apuca (crash), iar la repornire recovery-verify previne duplicatul (cu test-contrast care arata duplicatul fara recovery-verify).
- multi-instance pe Mongo real (`outboxMultiInstance.integration.test.ts`): doi workeri dreneaza simultan aceeasi coada si lease-ul atomic garanteaza livrare exact-o-data (zero duplicate); ruleaza in CI / local cu Mongo pornit, altfel se auto-sare.

In CI (`ci.yml`), pe langa `npm run check`, se ruleaza si validarea Rust prin scriptul unic `npm run check:native`: `cargo clippy --release --workspace --all-targets -- -D warnings` si `cargo test --release -p discord_patch_bot_logic` (teste unitare pe crate-ul pur). Profilul `--release` e ales intentionat: partajeaza target cache-ul cu `napi build --release` din `npm run check`, deci dependentele Rust se compileaza O SINGURA data per rulare CI, nu de doua ori (o data debug pentru clippy/test, o data release pentru addon). `native/` e un workspace Cargo cu doua crate-uri: `native/core/` (`discord_patch_bot_logic`, rlib pur, fara napi — toata logica si testele traiesc aici si ruleaza fara build-ul N-API) si wrapper-ul cdylib `discord_patch_bot_core` (`native/src/lib.rs`, doar conversii `#[napi]` care deleaga la core). Compilarea Rust se face deja prin `napi build` din `npm run build`.

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

**Politica de imagini si rebuild (decizie documentata):** imaginile de baza raman pe **tag-uri mutabile** (`node:24-bookworm-slim` si stage-ul de toolchain `rust:1.96.0-slim-bookworm` in `Dockerfile`, `mongo:7` in `docker-compose.yml` si in serviciile CI), NU pe digest-uri pinuite. Toolchain-ul Rust NU se mai instaleaza prin `curl | sh` de pe `sh.rustup.rs` (script remote executat direct la build): vine prin `COPY --from` din imaginea oficiala `rust`, cu versiunea sincronizata cu `src/native/rust-toolchain.toml` (gard in `supplyChainConfig.test.ts`). Motivatia: un digest pinuit ingheata si patch-urile de securitate pe care maintainer-ii le republica sub acelasi tag (digestul "putrezeste"), iar repo-ul nu are ecosistemul `docker` in Dependabot care sa-l improspateze automat — pin-ul ar schimba un risc teoretic de supply chain cu un risc real de baza neactualizata. Compensatiile active: (1) `apt-get upgrade -y` in stage-ul de runtime aduce patch-urile distro la fiecare build; (2) scanarea **Trivy blocanta** (CRITICAL/HIGH, `exit-code 1`) ruleaza pe imaginea construita la fiecare push relevant pe `main`, saptamanal (cron) si manual (`container-scan.yml`); (3) imaginea publicata pe GHCR la release e identificata imutabil prin tag-ul semver propriu (`vX.Y.Z`), deci reproducerea unui release inseamna a folosi imaginea publicata, nu a reconstrui baza. Rebuild-ul imaginii se face la fiecare release si oricand `Dockerfile`/dependintele se schimba; daca scanarea saptamanala pica, remedierea e un rebuild (care preia baza si patch-urile curente), nu un bump de digest.

## Note arhitecturale

Arhitectura curenta foloseste granite explicite si verificabile la compilare:

- runtime-ul comenzilor este construit ca `CommandRuntimeDependencies`, impartit in `discord`, `mongo`, `sources` si `platform`; contractul grupat ramane forma publica si nu mai este reconstruit printr-un helper global de flattening;
- handler-ele sunt enumerate prin descriptori declarativi cu `id`, `domain`, `scope`, `access`, `help`, `autocomplete` si `build`, iar dispatcherul ruleaza in ordinea DECLARARII din lista (fostul camp `priority` era mereu egal cu indexul si sort-ul era identitate — ceremonie eliminata; `autocomplete` e declarat primul, `fallback` ultimul, iar suprapunerile de ownership sunt oricum fatale la boot prin `commandOwnership`);
- `GuildSettings` este compus din contracte pentru identitate, configuratie, securitate si stare operationala, iar `RuntimeEnv` din contracte pentru identitate, persistenta, retea, livrare, fiabilitate si cache; schemele Mongo primesc contractul mai mic `MongoModelEnv`;
- pipeline-ul comun `notificationFeedLoader` gestioneaza fetch, snapshot validat si fallback pentru update-uri si reduceri, iar serviciile pastreaza regulile specifice domeniului; politica implicita pentru itemi invalizi este `reject-snapshot` (un snapshot complet invalid nu devine feed gol), iar `drop-invalid` este disponibila doar pentru consumatori care accepta explicit rezultate partiale;
- task-urile periodice simple folosesc `ScheduledTaskRunner`, care impiedica suprapunerea, transmite abort si asteapta task-ul activ cu timeout la shutdown;
- modulele aplicatiei si scripturile folosesc ESM; nu mai exista boundary-uri CommonJS in codul sursa;
- operatiile administrative multi-document folosesc versiuni monotone per resursa, versiune de schema, heartbeat, limita de retry si starile terminale `done`/`superseded`/`failed`; recovery ruleaza la boot si periodic;
- outbox-ul trateaza `delivered-pending` ca stare de finalizare prioritara, exclusa din sweep-ul si TTL-ul joburilor nelivrate.

Compozitia runtime foloseste factory-uri cu dependinte explicite. Registrul surselor si runtime-ul Redis sunt construite in composition root-ul neutru `app/runtimeComposition.ts`, nu prin citiri din `mongoContext` in modulele de infrastructura.

Granitele tiparii — ce ramane intentionat mai lax (ca afirmatiile de mai sus sa fie verificabile, nu doar optimiste): (1) **adaptoarele `attachX(target: XDeps & Record<string, unknown>)`** accepta inca punga de context pe **input-ul de compatibilitate** (nu pe deps-ul factory-ului) — e marginea sistemului, planificata sa dispara odata cu adaptoarele; (2) `commandRegistry` se compune acum **imutabil** prin `createAppServices` (fiecare zona obtinuta prin spread in obiecte noi, fara mutatie in-place a unui `base` partajat), are un **contract de export inchis** (`RequiredCommandRegistry`) verificat de `tsc`, iar registrul public returnat e `Object.freeze`-uit; `sourceRegistry` se compune acum **tot imutabil** (spread in obiecte noi `{ ...prev, ...attachX.buildFrom(prev) }`, ordonat `http -> steam -> updates -> deals`, fara `Object.assign(context, ...)` in-place, registru `Object.freeze`-uit), la fel ca `commandRegistry`; boundary-ul dinamic `installers: unknown[]` a fost eliminat din ambele; (3) **payload-urile dinamice** (raspunsuri de API extern, `Schema.Types.Mixed`, datele dintre handler-e si embed builders) sunt tipate `unknown` si ingustate la consum — `unknown` e alegerea sigura aici, nu o lipsa; (4) restul `Record<string, unknown>` din handler-e sunt obiecte de date construite local (embed-uri, optiuni), nu contracte de dependinte. Modelele Mongo din `mongoContext` au tipuri de document dedicate (`infra/mongo/modelTypes.ts`, gard in `mongoContextTypedApi.test.ts`); in tot codul runtime nu mai exista `: any` (verificabil cu `grep -rn ": any" --include="*.ts"` pe directoarele runtime).

Starea curenta:

- handler-ele pentru comenzi cunoscute sunt separate in `src/features/command-handlers/`;
- routing-ul interactiunilor e o **lista tipata `CommandHandler[]`** compusa in `commandRegistry`: fiecare handler expune `buildCommandHandler(ctx): CommandHandler` (`{ canHandle, handle }`), iar `dispatchCommand` itereaza lista si deleaga la primul `canHandle` adevarat (fallback-ul, mereu `canHandle: () => true`, e ultimul); comenzile admin (`start`/`stop`/`set`/`watchlist`/`snooze`/`unsnooze`/`backup`/`bot-log`/`server-log`/`outbox`/`health`/`config`/`reset-config`/`admin-alerts`/`price-alert`/`future-release`/`maintenance`/`youtube`/`sources`) trec intai printr-un pre-check `requireGuildAdmin`, apoi comenzile snoozed trec prin `commandSnoozeGuard` inainte de dispatcher; nu mai exista lantul de `attachX` care impacheteaza `handleInteraction` si nici un fisier `interactions.ts` separat;
- `notifications/index.ts` este wiring pentru cron jobs, iar logica principala este in `updateNotificationService.ts` si `discountNotificationService.ts`;
- toate modulele expun factory-uri cu deps explicit tipate: handler-ele de comenzi, `commandCache.ts`, `commandPresentation.ts`, `mongoContext.ts`, sursele `steam`/`deals`/`updates` (`createSteamSource`/`createDeals`/`createUpdates`) si `notifications/index.ts` (`createNotificationRuntime`); adaptorul `attachX(target)` construieste obiectul `deps` din campurile numite ale contextului (snapshot), nu mai paseaza punga de context;
- `domain/deals/filtersCore.ts`, `outboundChannel.ts` si `seenRepository.ts` sunt module tipate, usor de testat separat;
- `src/native/` contine Rust/N-API folosit pe calea de productie pentru hot-path-urile unde Rust e masurat mai rapid (vezi `BENCHMARKS.md`): hash-urile de dedupe (`dealHash`/`stableUpdateId`), distanta `levenshtein`, normalizarea/curatarea de text, clasificarea de patch notes, scoringul candidatilor de listing, filtrarea URL-urilor de articole Steam si scoringul de data. `findGameKeys` (fuzzy matching), `buildAutocompleteChoices` (autocomplete scoring) si `dealPassesFilters` (filtrarea ofertelor) sunt acum **TS-primary** (masurat mai rapid in TS din cauza marshaling-ului NAPI / calcul trivial); functiile native echivalente raman expuse doar pentru benchmark si testele de paritate, nu pe calea de productie;
- TypeScript-ul strict e **global**: `src/tsconfig.json` are `strict: true` peste tot codul (migrarea incrementala prin `tsconfig.strict.json` s-a incheiat si fisierul a fost eliminat — `npm run typecheck` e sursa unica de adevar);
- `legacy-dynamic.d.ts` a fost eliminat; tipurile trebuie rezolvate local, nu prin extinderea globala a `Object`.
- codul runtime din `app`, `domain`, `features`, `infra`, `shared` si `sources` nu mai contine `: any` si nici abrevierea legacy de context; zonele `unknown`/`Record<string, unknown>` ramase sunt cele enumerate la "granitele tiparii" de mai sus (adaptoare de compatibilitate, bag-ul de wiring, payload-uri dinamice), nu contracte de factory.
- fisierele de cod sunt tinute fara comentarii explicative; contextul de arhitectura, operare si mentenanta sta in README, changelog si `docs/`.

Singurele `[key: string]: unknown` / `& Record<string, unknown>` ramase sunt **intentionate** si nu sunt contracte de input de factory: tipurile de date dinamice (definite per domeniu in `sources/sourceTypes.ts`, `features/notifications/notificationTypes.ts`, `features/admin-records/adminRecordsTypes.ts`, `features/youtube/youtubeTypes.ts` si re-exportate prin agregatorul `types.ts`), schema Mongo (`infra/mongo/models.ts`) si adaptoarele de compatibilitate care citesc date dinamice si le ingusteaza local. `commandRegistry.ts` nu mai foloseste nici `LegacyInstallerTarget`, nici mecanismul de installers dinamici: compune explicit prin factory-uri reale tipate (`createCommandCache`, `createCommandPresentation`, `createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) compuse **imutabil** intr-un `createAppServices` (fiecare zona prin spread in obiecte noi, fara `Object.assign(base, ...)` pe un singur obiect mutat; registrul public returnat e `Object.freeze`-uit), plus o **lista tipata `CommandHandler[]`** (din `attachX.buildCommandHandler(ctx)`) rutata de `dispatchCommand` (loop `canHandle`/`handle`, fallback ultimul), cu pre-check-ul admin ca singur wrapper, si intoarce contractul inchis `RequiredCommandRegistry` (verificat de `tsc`, nu de un boundary `unknown[]`). Detalii si exceptii in `docs/architecture/CONTEXT_REPO_CLEAN.md`.

Registrele de wiring compun explicit factory-urile si valideaza fail-fast exporturile obligatorii. `sourceRegistryFactory` primeste `SourceRuntimeDeps`, iar `sourceRegistry` este fatada compatibila peste instanta construita in composition root.

## Documentatie suplimentara

- `docs/architecture/CONTEXT_REPO_CLEAN.md` - stare curenta, structura si zone ramase.
- `docs/architecture/FUNCTION_MAP_CLEAN.md` - harta pe module si responsabilitati.
- `docs/architecture/redis.md` - integrarea Redis (optionala): rol, limite, ce sta in Mongo vs Redis, ce nu e inca inclus.
- `docs/architecture/scaling-readiness.md` - ce pregatim vs. amanam intentionat (BullMQ/worker/dashboard/sharding/microservicii): ce e gata, praguri de declansare, boundaries.
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
- Protectia bot-add identifica solicitantul din audit log, consuma atomic o aprobare one-time pentru perechea exacta bot + solicitant si elimina botii fara aprobare valida.
- Protectia continutului inspecteaza linkurile, redirecturile si atasamentele dupa MIME si semnaturi. Sterge numai amenintarile confirmate; continutul incert ramane disponibil pentru verificare manuala, iar alerta nu reproduce payload-ul periculos.
- Delegarile neautorizate ale permisiunilor sensibile sunt detectate din audit log si restaurate la starea anterioara; ownerul serverului ramane singura exceptie.
- Moderarea valideaza motivele si atasamentele, foloseste rollback intre Discord si persistenta, compenseaza warn-urile dupa identificatorul exact si curata inregistrarile expirate sau ramase dupa plecarea membrului.
- Imaginea Docker e scanata cu **Trivy** (vulnerabilitati CRITICAL/HIGH, `ignore-unfixed`) si genereaza un **SBOM CycloneDX** prin workflow-ul `container-scan.yml` (push pe `main` cand se schimba Dockerfile/dependintele, **pe fiecare `pull_request` catre `main`**, saptamanal si manual). Pe PR ruleaza un pas-poarta Trivy cu `exit-code: 1` care **blocheaza merge-ul** daca imaginea are o vulnerabilitate fixabila CRITICAL/HIGH (la fel ca `check`); rezultatele Trivy apar in tab-ul Security (cod scanning, pe push/schedule), iar SBOM-ul e artifact. Completeaza CodeQL + Dependency Review (analiza de cod + dependinte) cu scanarea imaginii (supply chain). La release, imaginea publicata pe GHCR trece prin acelasi gate Trivy blocant **pe imaginea exacta**: build local (fara push), scanare, apoi `docker tag` + `docker push` pe bytes-ii scanati — nu exista cale de publicare nescanata. Tot la release ruleaza si `npm run canary:sources` (canary live pe surse, fail-closed pe API-urile fiabile) pe codul exact al tag-ului.

## Licenta

MIT. Vezi `LICENSE`.
