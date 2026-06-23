# Operare (runbook)

Ghid practic pentru operarea botului in productie, axat pe sistemul de notificari outbox.
Metricile sunt expuse la `/metrics` (Prometheus), iar comenzile admin `/outbox` ofera
vizibilitate si control direct din Discord.

Pe scurt, instrumentele de operare:

- Metrici Prometheus la `/metrics` (vezi README sectiunea health/metrics).
- Comenzi admin: `/outbox status | deadletters | clear-deadletters | replay-deadletters | retry | drain-now | pause | resume | permissions | recovery-verify status`.
- Alerte admin (webhook): trimise automat la `recoveryFailures > 0` (`outbox:recovery-read`),
  `markSentFailures > 0` (`outbox:mark-sent`), `deleteFailures > 0` (`outbox:delete` — job-uri
  procesate care nu s-au putut sterge din coada; raman deduse/reluate) si `deadLetterFailures > 0`
  (`outbox:deadletter-write` — scrierea unui audit dead-letter a esuat: pe caile terminale (expirare /
  `permanent` / `max-attempts`) job-ul **NU** e sters, ca payload-ul de replay sa nu se piarda (ramane in
  coada pana se reia auditul); pe calea `delivered-marksent-failed` job-ul deja livrat e **totusi sters**
  (ca sa nu se duplice mesajul), deci se pierde doar urma de dedupe-degradat a acelui mesaj — coreleaza cu
  `bot_outbox_mark_sent_failures`). Fiecare alerta vine ca embed structurat cu
  **severitate** (FATAL/WARNING/INFO + culoare), **Cauza** (eroarea reala), **Ce inseamna** si
  **Ce trebuie facut** (remediere per tip de alerta) — maparea kind -> ghidaj e in
  `src/infra/mongo/adminAlertContent.ts`.

## Cand creste `bot_outbox_queue_depth`

Coada de joburi outbox creste mai repede decat reuseste worker-ul sa o dreneze.

1. Confirma cu `/outbox status` (joburi in coada per-server si global) si verifica daca
   drenarea nu e cumva pe pauza (`Drenare: PE PAUZA`). Daca e, `/outbox resume`.
2. Verifica `bot_outbox_oldest_job_age_seconds` — daca creste continuu, joburile nu se
   livreaza (canal/permisiuni/Discord down), nu doar volum mare.
3. Verifica `bot_outbox_lock_acquire_failures` — daca creste, alta instanta tine lock-ul
   (multi-instanta) sau lock-ul nu se elibereaza; asigura-te ca ruleaza o singura instanta
   sau ca lock-ul `outbox_drain` are TTL corect.
4. Daca e doar volum mare (backlog temporar legitim): scade `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS`
   (drenare mai deasa) si/sau creste `NOTIFICATION_OUTBOX_DRAIN_LIMIT` (mai multe joburi per ciclu).
   TTL-ul lock-ului se auto-dimensioneaza din aceste valori, deci nu trebuie ajustat manual.
5. Daca livrarea e blocata de rate-limit Discord, vezi sectiunea „Rate-limit Discord".
6. Daca backlog-ul devine **cronic** (queue depth > 500 sustinut ≥ 2h **in timp ce worker-ul
   chiar dreneaza** — `bot_outbox_last_drain_age_seconds` mic), nu mai e un incident: e pragul
   de declansare pentru optimizarea de batch claim. Vezi `ROADMAP.md` („Outbox: claim in batch")
   si alerta `OutboxBatchDrainRecommended`.

**Dezabonare in timpul drenarii.** Inainte de a livra un job, drain-ul revalideaza ca guild-ul e inca
abonat pe acel canal (`subscribed`+`notificationChannelId` pentru update / `discountsSubscribed`+`discountChannelId`
pentru reduceri). Daca cineva a dat `/stop` intre enqueue si drain, jobul e **scos din coada fara livrare**
(nu e dead-letter, nu e un esec) — asa nu mai trece o ultima notificare dupa `/stop`. Verificarea e fail-closed
la eroare Mongo: daca interogarea esueaza tranzitoriu, jobul **nu** se livreaza, ci se reprogrameaza cu backoff si
ramane in coada pana cand abonarea poate fi confirmata.

## Cand creste `bot_outbox_mark_sent_failures`

Mesaje au fost trimise pe Discord, dar marcarea lor in istoricul de dedupe
(`notificationOutboxSent`) a esuat (chiar si dupa `withMongoRetry`). Risc: la o reluare
(recovery) acele mesaje pot fi re-trimise (duplicate).

1. Cauza tipica: Mongo intermitent/lent sau probleme de scriere. Verifica sanatatea Mongo
   (`/health` campul `mongo`, latenta, conexiuni).
2. Daca e tranzitoriu si s-a oprit, nu e nevoie de actiune — istoricul are TTL
   (`NOTIFICATION_OUTBOX_SENT_TTL_HOURS`, implicit 24h) si fereastra de risc e mica.
3. Daca persista si duplicatele sunt costisitoare, activeaza recovery-verify (vezi mai jos)
   sau modul strict, ca o reluare sa nu re-trimita inainte de a verifica istoricul canalului.
4. Fiecare astfel de esec lasa si o intrare de **audit** in dead-letter cu motivul
   `delivered-marksent-failed` (vizibila la `/outbox deadletters`): mesajul a fost livrat, dar
   marker-ul de dedupe nu a putut fi persistat. Jobul nu se re-trimite (e sters, ca sa nu apara
   duplicat), insa intrarea de audit iti spune exact ce mesaj poarta riscul mic de duplicare la
   o eventuala recovery — nu e un esec de livrare propriu-zis.
5. Drain-ul curent se opreste dupa jobul livrat cu `markSent` esuat. Urmatorul tick va reevalua
   coada normal, dar botul nu continua sa trimita alte joburi in acelasi batch cat timp a observat
   ca istoricul de dedupe nu poate fi scris.

## Cand creste `bot_outbox_recovery_verify_failures`

Recovery-verify e activ, dar botul nu poate citi istoricul canalului (de obicei lipseste
permisiunea **Read Message History**). In modul implicit (fail-open) mesajul se trimite oricum.

1. Vei primi si admin alert-ul `outbox:recovery-read`.
2. Acorda botului permisiunea **Read Message History** pe canalele de notificari/reduceri.
   `/set outbox-recovery-verify on` avertizeaza deja la activare daca permisiunea lipseste,
   iar `/outbox permissions` auditeaza oricand permisiunile curente (Send Messages / Embed
   Links / Read Message History) pe canalele configurate.
3. Daca duplicatele sunt foarte grave si preferi sa NU se trimita pana cand verificarea
   reuseste, porneste modul strict: `NOTIFICATION_OUTBOX_RECOVERY_STRICT=true` (fail-closed:
   reprogrameaza jobul cu backoff in loc sa trimita).

## Cand creste `bot_outbox_recovery_marker_missing`

Fetch-ul de istoric a reusit, dar marker-ul `dedupeKey` nu a fost gasit in ultimele mesaje,
deci mesajul a fost re-trimis. Diferit de `recovery_verify_failures` (acolo fetch-ul esueaza).

1. Daca valoarea e mica/sporadica, e normal — inseamna ca jobul chiar nu fusese livrat.
2. Daca e mare, marker-ul iese din fereastra de scanare pe canale aglomerate: creste
   `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` (implicit 25; max 100).

## Cand creste `bot_native_fallback_total`

Unul sau mai multe apeluri native (Rust) au aruncat exceptii si au cazut pe implementarea
TypeScript. Addon-ul nativ s-a incarcat (altfel boot-ul ar fi esuat in productie), dar o
functie specifica esueaza la runtime — risc de divergenta de rezultat sau de performanta fata
de Rust. Alerta `NativeFallbackActive` se declanseaza cand metrica creste.

1. Identifica functia care cade pe fallback direct din metrica per-functie:
   `bot_native_fallback_total{fn="..."}` (cele cinci functii inca native-primary, emise mereu ca serie
   stabila chiar la `0`: `classifyPatchNote`, `scoreListingCandidate`, `rankListingCandidates`,
   `isGoodSteamArticleUrl`, `extractDateScore`); agregatul e `sum(bot_native_fallback_total)`.
   Sau cauta in log-uri liniile `[NATIVE_FUZZY] Apelul nativ \`<functie>\` a esuat` (throttled la o
   data per minut per functie).
2. Cea mai probabila cauza este un addon nativ invechit sau incompatibil (semnatura schimbata
   intre versiuni). Re-build cu `npm run build:rust` si redeploy.
3. Pana la remediere, comportamentul ramane corect (fallback-ul TS produce acelasi rezultat),
   dar `dealHash` / `stableUpdateId` au cai separate care nu cad pe acest fallback — daca acolo
   apar erori, vezi sectiunea despre addon-ul nativ din `README` / fail-fast la boot.

## Canary surse (verificare live programata)

`npm run canary:sources` (script `scripts/canarySources.ts`) face un fetch **live** pe sursele
**API fiabile** — jocurile cu tip in `RELIABLE_CANARY_TYPES` (`steam` implicit/explicit prin ISteamNews,
`minecraft` prin manifestul piston-meta, `roblox` prin clientsettings; toate API-uri JSON fara anti-bot,
selectate de `filterCanaryGames`) si reducerile (`fetchDeals`: Steam specials + Epic GraphQL) — si
raporteaza cate jocuri au intors date valide. La deals raporteaza si **breakdown-ul pe store**
(`summarizeDealsByStore`); daca totalul e OK dar **0 oferte vin de la Epic Games**, emite un
`::warning::` (nu pica — IP-urile de runner pot fi blocate de Epic, dar disparitia totala a Epic merita
verificata manual; lectie: endpoint-ul `graphql.epicgames.com` a fost retras si nimeni n-a observat).
Scop: prinde proactiv cand o sursa isi schimba API-ul/formatul (schema drift) — lectie: doar jocurile
`steam` erau verificate, iar sursele `minecraft` (host DNS inexistent) si `roblox` (path 404) au ramas
rupte luni de zile fara nicio alerta. **Sursele scraped/proxy** (`listing_based`, `epic_games`/fortnite
prin proxy, driverele prin Google News RSS) ruleaza intr-un **pas separat warning-only**
(`filterFragileCanaryGames` + `buildFragileWarnings`): un tip fragil cu 0 jocuri OK emite
`::warning::[canary-sources] sursa fragila ...` dar **nu afecteaza exit code-ul** — depind de
`PROXY_URLS` si de scraping HTML fragil, deci un esec poate fi blocaj de IP/retea, nu sursa rupta;
daca warning-ul persista mai multe nopti, verifica manual cu `PROXY_URLS` setat.

- Ruleaza **programat (nightly) + manual** prin workflow-ul `canary.yml` (`workflow_dispatch` sau cron),
  **nu** ca check obligatoriu pe PR: poate pica din cauza Steam/Epic/internet, nu a codului, deci n-ar
  trebui sa blocheze merge-urile. Foloseste un serviciu Mongo doar pentru circuit breaker (fail-open daca
  lipseste).
- **Pica (exit 1)** cand un **tip de sursa fiabila** are **0 jocuri** care intorc date valide — semnal ca
  integrarea acelei surse e rupta (nu un blip tranzitoriu pe un singur joc, care lasa restul tipului OK).
  La esec apare `::error::[canary-sources] sursa "<tip>": 0/N ...`.
- **Fail-closed pe crash:** daca `getLatestForAllGames` sau `fetchDeals` **crapa complet** (exceptie, nu
  doar rezultate goale), canary-ul **pica** in loc sa ramana verde (lectie: catch-ul vechi seta
  `dealsOk=true`, deci endpoint-ul de reduceri putea muri complet fara alerta). Pentru rulari controlate
  cu retea instabila exista opt-out-ul explicit `ALLOW_CANARY_NETWORK_SKIP=true` (nesetat in CI).
- **Cand pica:** verifica daca site-ul sursei si-a schimbat structura (selectoare cheerio / endpoint /
  format JSON). Daca da, actualizeaza parserul sursei respective (`sources/updates` sau `sources/deals`)
  si confirma cu `npm run canary:sources` local. Un singur joc esuat dintr-un tip cu mai multe jocuri
  ramane doar informativ (tranzitoriu), nu pica.

## Migrari DB la boot (fail-fast)

Migrarile de schema ruleaza la pornire, sub un lock (`acquireDbLock`), o singura instanta pe boot.
Implicit, o migrare esuata este **fatala**: botul **opreste pornirea** (fail-fast) in loc sa ruleze
cu o schema inconsistenta (ex. fara indexul unic *sparse* pe `notificationOutbox.dedupeKey`, ceea ce
ar permite notificari duplicate). Procesul iese cu cod non-zero, iar orchestratorul (Docker/k8s) il
reporneste, deci migrarea se **reincearca** la urmatorul boot — fara fereastra de rulare degradata
intre timp.

- In log apare `ERROR MIGRATE Migrari esuate la boot — opresc pornirea (fail-fast ...)` urmat de un
  admin alert `boot:fatal`. Daca botul intra in crash-loop la boot, **cauza e o migrare** care esueaza
  constant (ex. date care impiedica crearea unui index unic): investigheaza si curata datele, nu
  reporni orbeste.
- Escape hatch de urgenta: `MIGRATIONS_CONTINUE_ON_ERROR=true` porneste botul **oricum** peste o migrare
  esuata (log `ERROR MIGRATE ... continui fara ele` + admin alert `boot:migrations`). Foloseste-l doar
  temporar, constient ca schema poate fi inconsistenta (risc de duplicate). Revino la fail-fast (scoate
  variabila) dupa remediere.

## Validarea `.env` la boot (flag-uri booleene si numerice)

Toate flag-urile booleene operationale (`METRICS_PUBLIC`, `TRUST_PROXY`, `NOTIFICATION_OUTBOX_ENABLED`,
`NOTIFICATION_OUTBOX_RECOVERY_VERIFY`, `NOTIFICATION_OUTBOX_RECOVERY_STRICT`, `MIGRATIONS_CONTINUE_ON_ERROR`,
`ALLOW_DEFAULT_PROXIES`) sunt validate la pornire de schema Zod din `shared/env.ts`: trebuie sa fie
`true` / `false` / `1` / `0` (case-insensitive). Un **typo** (`treu`, `yes`, `2`) **opreste boot-ul**
cu `ERROR ENV Pornire blocata: ... <NUME> (<NUME> trebuie sa fie true/false/1/0)` — nu mai e tratat
silentios ca `false`, ca inainte. O variabila **neset** sau **goala** (`FOO=`) ramane permisa si
foloseste default-ul. Daca botul refuza sa porneasca cu acest mesaj, corecteaza valoarea flag-ului
numit (sau scoate-l ca sa revii la default).

La fel, **toate knob-urile numerice** (`FETCH_CONCURRENCY`, `MAX_DEALS`, `DISCORD_SEND_RATE_*`,
`NOTIFICATION_OUTBOX_*`, `CRON_*`, limitele de cache etc., citite prin `parseEnvNumber`) sunt
fail-fast la boot: o valoare **ne-numerica** (typo ca `5oo0` sau `abc`) **opreste boot-ul** cu
`ERROR ENV Pornire blocata: <NUME>="<valoare>" nu este un numar valid (interval permis ...)` in loc
sa cada tacut pe default. O variabila **neset/goala** foloseste in continuare default-ul, iar un numar
valid dar in afara intervalului `[min, max]` ramane **clamp-uit** la margine cu un `WARN` (comportament
defensiv neschimbat). Daca botul nu porneste cu acest mesaj, corecteaza valoarea numerica a variabilei numite.

## Indexuri MongoDB (inventar)

Index-urile sunt declarate in `src/infra/mongo/models.ts` si construite automat de Mongoose la
pornire (`autoIndex` implicit activ). Verificarea statica `npm run check:db-indexes` confirma ca
fiecare index e pe un camp real din schema, ca nu exista declaratii duplicate si ca fiecare colectie
de mai jos e documentata aici; daca un Mongo e disponibil, ruleaza si `syncIndexes` ca sa prinda
index-uri conflictuale/invalide. Inventarul declarat curent:

| Colectie | Cheie | Optiuni | Rol |
| --- | --- | --- | --- |
| `guilds` | `{ subscribed, notificationChannelId }` | — | enumerarea guild-urilor abonate la update-uri la dispatch |
| `guilds` | `{ discountsSubscribed, discountChannelId }` | — | enumerarea guild-urilor abonate la reduceri |
| `guildSeenDiscounts` | `{ guildId, dealHash }` | unique | dedup per-guild al reducerilor deja trimise |
| `guildSeenDiscounts` | `{ seenAt }` | TTL `GUILD_SEEN_DISCOUNT_TTL_DAYS` (implicit 60 zile) | curatare automata a istoricului de reduceri vazute |
| `guildSeenUpdates` | `{ guildId, gameKey, updateId }` | unique | dedup per-guild al update-urilor deja trimise |
| `notificationOutbox` | `{ availableAt, lockedUntil }` | — | claim-ul joburilor disponibile la drenare |
| `notificationOutbox` | `{ dedupeKey }` | unique, sparse | impiedica doua joburi pending cu acelasi `dedupeKey` (sparse: joburile fara cheie coexista) |
| `notificationOutbox` | `{ createdAt }` | TTL 7 zile | plasa de siguranta pentru joburi nedrenate |
| `notificationOutboxSent` | `{ dedupeKey }` | unique | istoricul de livrari pentru dedup la recovery |
| `notificationOutboxSent` | `{ sentAt }` | TTL `NOTIFICATION_OUTBOX_SENT_TTL_HOURS` (implicit 24h) | expirarea istoricului de dedup |
| `notificationHistory` | `{ guildId, sentAt }` | TTL `NOTIFICATION_HISTORY_TTL_DAYS` (implicit 30 zile) | istoricul notificarilor livrate efectiv per server, pentru comanda `/history`; scris dupa send-ul real (cu outbox: la livrarea din coada, nu la enqueue) |
| `feedbackReports` | `{ guildId, createdAt }` | TTL `FEEDBACK_REPORT_TTL_DAYS` (implicit 90 zile) | rapoartele trimise de utilizatori prin comanda `/report` |
| `notificationDeadLetterReplay` | `{ updatedAt }` | TTL `NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS` (implicit 7 zile) | expira payload-ul de replay; `updatedAt` se reimprospateaza la fiecare re-record, deci TTL se masoara de la ultimul dead-letter |
| `notificationDeadLetterReplay` | `{ guildId, createdAt }` | — | listare FIFO a payload-urilor de replay per server (`/outbox replay-deadletters`) |
| `notificationDeadLetterReplay` | `{ guildId, dedupeKey }` | unique, partial (`dedupeKey != ""`) | dedup la re-record (replay esuat -> re-dead-letter nu acumuleaza duplicate) |
| `joblocks` | `{ lockedUntil }` | — | gasirea/expirarea lock-urilor distribuite (cron/outbox) |
| `adminalertcooldowns` | `{ lastSentAt }` | TTL 7 zile | cooldown per-alerta pentru admin alerts |
| `fetchsnapshots` | `{ fetchedAt }` | TTL 1 zi | event store pe fetch (hidratare cache la boot) |

Cand adaugi/modifici un index in `models.ts`, actualizeaza tabelul de mai sus — altfel
`check:db-indexes` esueaza (Regula: codul reflectat in documentatie).

## Migrarea hash-ului de dedup (`HASH_VERSION`)

Hash-urile de deduplicare (`dealHash`, `stableUpdateId`) folosesc SHA-256, versionat prin
`HASH_VERSION`. Cand `HASH_VERSION` creste (schimbare de algoritm), la **primul ciclu cron**
fiecare guild cu o versiune stocata invechita (`seenHashVersionUpdates` / `seenHashVersionDiscounts`)
este **re-baseline-uit**: hash-urile curente sunt marcate ca „vazute" si versiunea e actualizata,
**fara** a trimite notificari in acel ciclu. Asadar, dupa un deploy care schimba algoritmul:

- este normal sa apara in log `Re-baseline dedup ...` pentru guild-uri si sa NU soseasca notificari
  in primul ciclu — este intentionat (previne spam-ul care ar aparea daca toate hash-urile ar parea noi);
- notificarile reale revin de la al doilea ciclu, normal. Nu necesita interventie.

## Rate-limit Discord

Daca livrarile sunt incetinite de rate-limit:

1. Cresterea `bot_outbox_oldest_job_age_seconds` + `bot_outbox_queue_depth` fara erori
   indica throttling, nu esecuri.
2. Bot-ul respecta deja un token-bucket global la trimitere; nu forta drenarea agresiv.
3. Daca e backlog temporar, lasa worker-ul sa-l goleasca; pentru urgente punctuale,
   `/outbox retry` reprogrameaza joburile acestui server pentru livrare imediata, iar
   `/outbox drain-now` porneste o drenare pe loc doar daca drenarea nu e pe pauza si lock-ul `outbox_drain` e liber.

## Mentenanta: pauza drenarii

Pentru interventii (canal in remediere, migrare, debugging) fara a opri tot botul:

- `/outbox pause` — opreste drenarea (global); joburile raman in coada, lock-ul nu e atins.
- `/outbox resume` — reia drenarea de unde a ramas.
- `/outbox status` arata starea (`Drenare: ACTIVA | PE PAUZA`).
- `/outbox drain-now` respecta aceeasi pauza globala; daca drenarea e pe pauza, refuza pornirea manuala si cere `/outbox resume`.

## Cand activezi / dezactivezi `/set outbox-recovery-verify`

- **Activeaza** (`on`) pe servere unde duplicatele sunt inacceptabile si canalul de
  notificari e aglomerat (risc real de reluari dupa restart). Costa un footer vizibil pe
  fiecare embed + un fetch de mesaje la fiecare recovery. Asigura **Read Message History**.
- **Dezactiveaza** (`off`, implicit) cand vrei zero overhead vizual/IO si te bazezi pe
  lease + istoricul de dedupe (suficient pentru majoritatea cazurilor).
- Poate fi setat global (`NOTIFICATION_OUTBOX_RECOVERY_VERIFY`) sau per-server prin comanda.
- `bot_outbox_recovery_verify_enabled_guilds` arata cate servere au protectia activa.

## Setari recomandate pe dimensiune de server

Reglajele tin de volumul de notificari (jocuri urmarite x servere abonate), nu de numarul
brut de membri. Valorile sunt puncte de plecare.

### Server mic (1-50 servere abonate, volum mic)

- `NOTIFICATION_OUTBOX_ENABLED=false` este acceptabil (trimitere inline simpla), sau `true`
  daca vrei rezilienta la caderi Discord.
- `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS=15000`, `NOTIFICATION_OUTBOX_DRAIN_LIMIT=50`.
- `NOTIFICATION_OUTBOX_RECOVERY_VERIFY=false`.

### Server mediu (50-300 servere, volum moderat)

- `NOTIFICATION_OUTBOX_ENABLED=true` (decupleaza detectia de trimitere).
- `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS=10000`, `NOTIFICATION_OUTBOX_DRAIN_LIMIT=100`.
- `NOTIFICATION_OUTBOX_SENT_TTL_HOURS=24`.
- Recovery-verify per-guild doar pentru serverele care cer protectie maxima.

### Server mare (300+ servere, volum ridicat)

- `NOTIFICATION_OUTBOX_ENABLED=true`.
- `NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS=5000`, `NOTIFICATION_OUTBOX_DRAIN_LIMIT=200-500`
  (TTL-ul lock-ului se auto-dimensioneaza; nu seta manual decat daca un drain depaseste
  legitim plafonul auto).
- `NOTIFICATION_OUTBOX_SENT_TTL_HOURS=48` (recovery dupa deploy-uri lungi).
- Monitorizeaza activ `bot_outbox_queue_depth`, `bot_outbox_oldest_job_age_seconds` si
  `bot_outbox_dead_lettered`; alerteaza pe crestere sustinuta.

## Scalare la multe guild-uri (gateway sharding)

Limita reala de scalare nu e Node/Mongo/limbaj, ci Discord. Doua semnale si ce inseamna:

1. **Te apropii de ~2.500 de guild-uri** → Discord **impune sharding** la gateway (refuza o
   conexiune ne-shardata peste prag). Clientul curent e single-shard
   (`new Client({ intents: [Guilds] })`), deci la acest prag trebuie configurat sharding —
   `shards: 'auto'` (un proces) sau `ShardingManager` (N procese). Plan complet + constrangeri in
   `ROADMAP.md` („Sharding gateway Discord").
2. **Throttling la trimitere** (sectiunea „Rate-limit Discord" de mai sus) → e limita REST a
   token-ului, **per token**; sharding-ul gateway **nu** o mareste. Nu adauga al doilea token (UX/ToS).

Ce e deja pregatit pentru rulare distribuita: munca periodica e coordonata prin lock-urile DB
`cron_main` (cron) si `outbox_drain` (drenare), deci **un singur** runner executa munca chiar daca
ruleaza mai multe instante/shard-uri. Ce **nu** e pregatit: gateway-ul (rularea naiva a mai multor
copii cu acelasi token, fara shard ID-uri, e respinsa de Discord). Pana la pragurile de mai sus,
single-shard + lock-uri DB e corect si suficient — nu shard-a preventiv.

## Dead-letter

Cand o livrare epuizeaza reincercarile sau primeste o eroare permanenta, intra in
dead-letter (pe documentul guild-ului, plafonat). Inspecteaza cu `/outbox deadletters`.
Daca `bot_outbox_dead_lettered` creste, verifica permisiunile canalului si starea Discord;
dupa remediere, livrarile noi vor reusi (intrarile dead-letter raman pentru audit).

Dupa ce ai investigat si ai remediat cauza (ex. permisiuni de canal), poti **re-trimite**
livrarile esuate cu `/outbox replay-deadletters`: reintroduce in coada outbox fiecare livrare
dead-letter pentru care exista un **payload stocat** (colectia `notificationDeadLetterReplay`,
populata doar pe calea outbox la dead-letter, cu TTL `NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS`,
implicit 7 zile) si curata intrarile re-introduse din lista de audit. Necesita
`NOTIFICATION_OUTBOX_ENABLED=true`. Nu se reiau livrarile cu motiv `delivered-marksent-failed`
(au fost deja trimise — re-trimiterea ar duplica) si nici cele al caror payload a expirat prin TTL.
Daca o reintroducere pica la mijloc, comanda raspunde `Replay partial: N reintroduse` — cele
reusite sunt deja scoase din dead-letter (nu se vor re-trimite la o noua rulare), iar restul raman
in dead-letter; reincearca `/outbox replay-deadletters` dupa ce verifici cauza.

Daca preferi sa NU re-trimiti, poti goli lista de audit cu `/outbox clear-deadletters` — sterge
toate intrarile `notificationDeadLetter` ale serverului curent (scriere atomica + invalidare cache)
si raporteaza cate au fost sterse. Foloseste-o doar dupa ce ai terminat investigatia: intrarile
sunt singura urma a livrarilor esuate.

Joburile au TTL de 7 zile pe `createdAt`. Ca sa nu fie sterse **tacut** de TTL daca raman
blocate (ex. outbox dezactivat/pe pauza mult timp, worker oprit), un sweep la fiecare drenare
muta in dead-letter joburile mai vechi decat `NOTIFICATION_OUTBOX_MAX_AGE_MS` (implicit 6 zile,
inainte de TTL), cu motivul `expired-near-ttl`, si incrementeaza `bot_outbox_expired`. Alerta
`OutboxJobsExpired` (`increase(bot_outbox_expired[1h]) > 0`) semnaleaza conditia: investigheaza
de ce nu s-au drenat (outbox oprit, canal stricat, worker cazut) — joburile au un audit clar in
dead-letter, nu dispar fara urma.
