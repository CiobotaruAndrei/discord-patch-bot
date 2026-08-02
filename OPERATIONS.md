# Operare (runbook)

Ghid practic pentru operarea botului in productie, axat pe sistemul intern de notificari outbox.
Metricile sunt expuse la `/metrics` (Prometheus), iar colectiile Mongo pastreaza starea si auditul.

Pe scurt, instrumentele de operare:

- Metrici Prometheus la `/metrics` (vezi README sectiunea health/metrics). Pe langa seriile de
  fetch/cron/outbox/cache, exista si metrici per comanda slash: `bot_commands_total{command}`
  (interactiuni tratate per comanda top-level), `bot_command_errors_total{command}` (erori
  scapate pana la handler-ul top-level de interactiuni) si `bot_command_duration_ms_total{command}`
  (timp total de procesare; media = duration_ms_total / commands_total). Seriile apar dupa prima
  interactiune a comenzii respective.
- Stare operationala: metricile `bot_outbox_*`, alertele admin si colectiile `notificationOutbox`, `guildDeadLetters` si `notificationDeadLetterReplay`.
- Alerte admin (webhook si/sau canale Discord configurate cu `/admin-alerts set channel:<canal>`): trimise automat la `recoveryFailures > 0` (`outbox:recovery-read`),
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

## Metrici pentru securitate si moderare

- `bot_security_runtime_errors` creste cand un listener de securitate sau moderare nu poate finaliza operatia. Verifica logul asociat, disponibilitatea Mongo/Discord si alerta administrativa; incidentul nu trebuie tratat ca simplu mesaj ratat.
- `bot_security_threats_deleted` numara numai mesajele sterse dupa confirmarea continutului periculos. O alerta `uncertain` nu incrementeaza seria si cere verificare manuala.
- Analiza pasiva de documente semnaleaza structural (fara executie) indicatori PDF/Office: macro VBA, `/JavaScript`/`/AA`/`/OpenAction`, `/Launch`/`/EmbeddedFile`/`/RichMedia`/`/GoToR`, campuri DDE si formulare `/XFA`. Numele PDF ofuscate prin escape-uri hex (`/J#61vaScript` -> `/JavaScript`) sunt de-ofuscate inainte de potrivire (`hasObfuscatedPdfActionName`), ca un atacator sa nu ocoleasca scanarea din fereastra de bytes; un token hex care se decodeaza intr-un nume benign (ex. `/Title`) nu produce fals-pozitiv. In intrarile de arhiva OOXML sunt semnalate si obiectele OLE incorporate (cale `word/embeddings/oleObject*.bin`, `/embeddings/`, `.ole`) — un vector fara macro; indicatorul pastreaza tot `uncertain`. Documentele OLE clasice (Compound File Binary: `.doc`/`.xls`/`.ppt` si obiectele `.bin`) sunt acum inspectate de un **parser structural CFB** (`inspectCompoundFileBinary`) care parcurge directorul compound (lantul FAT, cu bugete de sectoare/intrari, fara decodarea continutului stream-urilor) si semnaleaza macro-urile VBA (`Macros`/`VBA`/`_VBA_PROJECT`) si obiectele OLE incorporate (`ObjectPool`/`Ole10Native`/`Package`) dupa numele reale din director (UTF-16LE) — pe care scanarea latin1 a primului MiB nu le putea potrivi. Un document OLE curat nu primeste indicatori (fara escaladare doar dupa extensie). Acesti indicatori pastreaza verdictul `uncertain` (nu escaladeaza si nu sterg) pana la confirmarea unui motor extern pe obiectul complet. Arhivele ZIP/TAR/GZIP sunt inspectate recursiv cu bugete unificate; formatele fara decodor local (RAR/7Z) raman fara parcurgere interna dar sunt trimise motorului extern (legat de hash-ul obiectului complet) pentru un verdict confirmabil; arhivele criptate/trunchiate raman `uncertain`, fara sanctiune. Decodarea locala completa RAR/7Z si parserele structurale complete OOXML/PDF raman amanate (efort > 2000 linii); parserul structural OLE/CFB de mai sus e prima transa livrata.
- Inspectia descarca local cel mult primul fragment (1 MB) al unei resurse. Un verdict periculos al motorului extern (`malware`/`phishing`/`fraud`/`data-theft`/`exploit`) escaladeaza la `confirmed` numai daca obiectul descarcat este complet: completitudinea e dedusa din statusul HTTP (206 = partial), `Content-Range` si `Content-Length`. Un fisier peste limita ramane la verdictul de baza (fragmentul e semnalat, nu confirmat), iar un fisier altfel sigur descarcat doar partial devine `uncertain`, nu `safe`. Motorul extern primeste `complete` + `totalLength` (pe langa `contentSha256` legat de obiect) si trebuie sa refuze confirmarea unui fragment.
- `bot_security_bot_adds_blocked` numara botii eliminati fiindca audit log-ul nu a identificat solicitantul sau nu exista o aprobare pending valida pentru perechea exacta bot + solicitant.
- La `/bot-add-request`, canalul de aprobare este validat **inainte** de persistenta: daca lipseste, nu se creeaza nicio solicitare (fara pending orfan). Daca livrarea mesajului de aprobare esueaza dupa persistenta, solicitarea **nou-creata** este eliminata (compensare), iar utilizatorul primeste eroare cu indemn de reincercare; un retry reutilizeaza solicitarea pending existenta (fara duplicat activ pe bot + solicitant, garantat atomic in `createBotAddRequest`).
- `bot_permission_delegations_reverted` numara restaurarile automate ale permisiunilor sensibile acordate de altcineva decat owner. Coreleaza seria cu audit log-ul serverului pentru executor, tinta si permisiunea restaurata.
- La `/warn` si `/lock-channel`, mesajul obligatoriu pe canal (avertismentul, respectiv anuntul de blocare) este trimis prin metoda `send` **legata de canalul-tinta** (`channel.send.bind(channel)`). Metoda `send` din discord.js depinde de `this` (foloseste `this.client`/`this.id`); un apel detasat pe o referinta extrasa ar arunca `TypeError` la runtime chiar daca stub-urile din teste nu observau `this`. Daca livrarea esueaza, avertismentul salvat este compensat prin rollback, iar blocarea revine la permisiunea anterioara.
- Istoricul de warn-uri (`moderationWarnings`) este plafonat atomic la `MAX_WARN_HISTORY` (500) intrari: `addWarning` foloseste `$slice: [ { $concatArrays: [...] }, -MAX_WARN_HISTORY ]` in acelasi pipeline, deci documentul guild-ului nu mai poate creste nelimitat catre limita Mongo. Plafonarea e **self-healing**: un guild care are deja un array mai mare e retezat la urmatoarea adaugare de warn. Numarul pentru auto-ban si `/warn-list` se calculeaza din documentul returnat dupa scriere (atomic), deci ramane corect si sub concurenta.
- Un bot monitorizat dupa join are un context de observatie de 7 zile (`botObservations`). Pe langa modificarile de rol/overwrite/webhook (alimentate de runtime-ul de delegare) si mesajele botului, actiunile de server-log confirmate prin Audit Log — creare/stergere canal, creare/stergere rol, ban, kick, timeout — sunt corelate cu profilul botului printr-un adaptor comun, deduplicat dupa audit entry ID (`audit:<id>`), astfel incat acelasi eveniment sa nu fie contorizat de doua listener-e. O rafala (5 actiuni corelate intr-un minut) produce alerta `security:bot-observation-burst` o singura data.
- La `/start new-account-alerts`, scanarea conturilor existente foloseste ACELASI dedup ca notificarile pentru membrii noi: fiecare membru recent este **revendicat atomic** in colectia `newAccountAlertDeliveries` (index unic pe `{guildId, userId}`) inainte de trimitere, apoi marcat `delivered`. Astfel, daca scanarea esueaza la jumatate si comanda e reluata (sau botul reporneste), membrii deja alertati sunt sariti, iar un membru revendicat dar nelivrat este eliberat ca sa poata fi reincercat — o reactivare nu mai inunda canalul cu alerte duplicate. **Finalizare dedup:** daca `markDelivered` esueaza dupa un send reusit (hiccup Mongo), starea nu ramane `claimed` (care s-ar re-revendica dupa expirarea lease-ului de 5 min si ar duplica), ci este marcata `sent-unconfirmed` — o stare pe care revendicarea o exclude explicit (`status $nin ["delivered", "sent-unconfirmed"]`), deci nu se retrimite orb la restart; se logheaza WARN `NEW_ACCOUNT_ALERT` si comanda raporteaza separat cate alerte au fost confirmate vs trimise-dar-neconfirmate (vor fi reconciliate, nu retrimise). Doar un outage Mongo total (si `markDelivered`, si `markSentUnconfirmed` esueaza) lasa claim-ul reincercabil dupa lease.
- La `/lock-channel`, dupa ce permisiunea `SendMessages` a rolului @everyone este comutata si starea e persistata, anuntul obligatoriu de blocare se trimite prin `channel.send` **legat de canal** (`channel.send.bind(channel)`), fiindca metoda depinde de `this` (`this.client`/`this.id`); un apel detasat ar arunca `TypeError` la runtime, mascat doar de stub-urile de test fara `this`. Daca anuntul esueaza, compensarea reface atat starea din Mongo cat si overwrite-ul Discord la valoarea anterioara, deci canalul nu ramane blocat fara notificare.
- **Divergentele `/lock-channel` / `/unlock-channel` au recovery persistent automat.** Cand permisiunea Discord a fost modificata, persistenta a esuat SI ambele incercari de rollback au esuat, comanda inregistreaza divergenta in colectia `channelLockRecoveries` (`guildId`, `channelId`, comanda, starea anterioara, starea in care a ramas Discord si starea dorita). Un worker idempotent (`channelLockRecoveryTask`, la 2 minute) reia restaurarea: citeste starea CURENTA a overwrite-ului, si **doar daca aceasta este inca exact starea divergenta pe care am lasat-o noi** aplica restaurarea (verificare de tip CAS) — daca cineva a schimbat legitim permisiunea intre timp, recovery-ul NU suprascrie schimbarea, ci inchide inregistrarea cu log `WARN LOCK_CHANNEL_RECOVERY`. Dupa restaurare, starea e re-citita si verificata, apoi se persista in Mongo; inregistrarea se sterge **numai** dupa ce ambele converg. Seriile `bot_channel_lock_recovery_runs`, `bot_channel_lock_recovery_failures` si `bot_channel_lock_recoveries_converged` urmaresc worker-ul, iar `/maintenance` afiseaza cate canale au inca divergenta in asteptare.
- Compensarile raporteaza starea REALA, nu doar absenta unei exceptii. La `/warn`, daca livrarea pe canal esueaza si stergerea inregistrarii (compensarea) esueaza si ea, userul e informat explicit ca warn-ul RAMANE salvat si necesita `/remove-warn` manual (nu doar o eroare generica). La `/lock-channel`, cei doi pasi de revenire (persistenta + overwrite-ul Discord) ruleaza **independent**: daca primul esueaza, al doilea tot se incearca, iar raspunsul indica ce s-a compensat si ce necesita verificare manuala. Acelasi principiu acopera si calea **anterioara** mesajului, comuna `/lock-channel` si `/unlock-channel`: dupa ce overwrite-ul Discord a fost modificat, daca `setLockedChannelPermissionState` esueaza, revenirea permisiunii se **reincearca** (`revertOverwriteWithRetry`, 2 incercari) si rezultatul ei este **capturat**. Daca revenirea reuseste, starea e consistenta (Discord restaurat, nimic persistat) si eroarea generica e corecta; daca esueaza si ea, raspunsul NU mai e generic, ci descrie explicit **starea divergenta** (Discord modificat vs persistenta NESALVATA) si indica exact valoarea de restaurat (`allow`/`deny`/`inherit`) pentru canalul respectiv, plus un log `ERROR LOCK_CHANNEL` cu `guildId`/`channelId`/`command`/`previous` pentru recuperare. La `/bot-add-request`, mesajul spune ca solicitarea a fost anulata DOAR daca anularea pending-ului a reusit; altfel indruma userul sa astepte expirarea (10 min) sau sa ceara unui administrator.

La cresterea oricarei serii, verifica si canalul configurat prin `/admin-alerts set`: alertele contin tipul incidentului, severitatea, utilizatorul sau resursa implicata, actiunea automata si rezultatul, fara a reproduce continut executabil ori payload-uri periculoase.

Canalele configurate prin `/admin-alerts set` primesc aceeasi structura de embed ca webhook-ul global. Rapoartele noi sunt limitate la serverul care le-a generat; alertele operationale globale sunt distribuite tuturor canalelor administrative configurate. Daca fetch-ul canalului esueaza cu o eroare Discord permanenta, `adminAlertChannelId` este resetat automat ca botul sa nu repete la nesfarsit livrari imposibile. `/admin-alerts off` dezactiveaza doar destinatia Discord a serverului, nu si `ADMIN_WEBHOOK_URL`.

## Cand creste `bot_outbox_queue_depth`

Coada de joburi outbox creste mai repede decat reuseste worker-ul sa o dreneze.

1. Confirma adancimea prin `bot_outbox_queue_depth` si verifica starea worker-ului in logurile de runtime.
2. Verifica `bot_outbox_oldest_job_age_seconds` — daca creste continuu, joburile nu se
   livreaza (canal/permisiuni/Discord down), nu doar volum mare.
3. Verifica `bot_outbox_lock_acquire_failures` — daca creste, alta instanta tine lock-ul
   (multi-instanta) sau lock-ul nu se elibereaza; asigura-te ca ruleaza o singura instanta
   sau ca lock-ul `outbox_drain` are TTL corect. Lock-ul de drain e mentinut de un **heartbeat**
   (reinnoire periodica la ~1/3 din TTL, aceeasi primitiva `createLockHeartbeat` ca la cron): un drain
   lung nu mai poate lasa TTL-ul sa expire in timp ce inca lucreaza. Daca heartbeat-ul nu poate reinnoi
   (renew intoarce false sau esueaza de 2 ori consecutiv), drain-ul **se opreste intre joburi** (nu mai
   revendica joburi noi) ca sa nu ruleze in paralel cu instanta care a preluat lock-ul.
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
   `delivered-marksent-failed` in colectia `guildDeadLetters`: mesajul a fost livrat, dar
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
2. Acorda botului permisiunile **Send Messages**, **Embed Links** si **Read Message History** pe canalele de notificari/reduceri si verifica-le direct in configurarea canalului Discord.
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

## Inspectorul nativ izolat (crash-uri si timeout-uri)

Procesul `native-inspector` ruleaza parserele native in spatele unui filtru seccomp. Trei serii il
urmaresc, toate fail-safe (un esec lasa verdictul neconfirmat, nu confirma nimic):

- `bot_native_inspector_timeouts_total` — inspectia a depasit termenul supervizorului; alerta
  `NativeInspectorTimeouts`. Cauza tipica: arhiva/PDF patologic sau proces blocat. Continutul
  respectiv ramane la verdictul euristic.
- `bot_native_inspector_kills_total` — procesul a fost terminat in mijlocul unui job (crash,
  seccomp kill la un syscall interzis, sau terminare fortata dupa timeout).
- `bot_native_inspector_restarts_total` — repornirile supervizorului; alerta
  `NativeInspectorRestartsHigh` la peste 3 in 30m indica un crash-loop. Peste plafonul de
  restarturi, supervizorul se opreste si verdictele raman neconfirmate pana la interventie.

Diagnostic: log-urile `[NATIVE_INSPECTOR]` contin motivul fiecarui restart. Un kill de seccomp
repetat pe acelasi tip de continut sugereaza ca un parser incearca un syscall nou (ex. dupa un
upgrade de librarie C) — reprodu local cu fisierul respectiv si compara cu lista de syscall-uri
permise din `native/inspector/src/sandbox.rs`. `bot_native_inspector_sandboxed` spune daca filtrul
chiar e activ (1) sau procesul ruleaza fara sandbox (0, ex. pe Windows in dezvoltare).

## Motorul de reputatie/antivirus (esecuri si versiuni)

- `bot_threat_engine_scans_total` — raspunsuri reusite (indiferent de verdict).
- `bot_threat_engine_failures_total{reason}` — apeluri fara verdict utilizabil; alerta
  `ThreatEngineFailures`. `reason="transport"` = retea/timeout/exceptie; `reason="http-status"` =
  raspuns >= 400 (token gresit, motor supraincarcat). In ambele cazuri verdictul ramane `unknown`
  si protectia e doar euristica — nu se sterge nimic pe baza euristicilor singure.
- `bot_threat_engine_info{engine_version,database_version}` — ultimele versiuni observate ale
  motorului si bazei de semnaturi, exact cele legate in audit de hash-ul continutului scanat. O
  `database_version` care nu se mai schimba saptamani intregi inseamna ca motorul scaneaza cu
  semnaturi vechi — semnaleaza operatorului motorului.
- `bot_threat_engine_version_changes_total` — cate schimbari de versiune au fost observate dupa
  prima; fiecare schimbare e logata `INFO THREAT_REPUTATION` cu valorile vechi si noi.
- `bot_threat_engine_last_scan_age_seconds` + alerta `ThreatEngineSilent` (info, >24h fara nicio
  scanare reusita desi motorul e configurat si a raspuns candva): pe servere linistite e normal;
  altfel coreleaza cu seria de failures.

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

## Operare monitorizare YouTube

Monitorizarea YouTube foloseste feed-ul Atom public al fiecarui canal, fara API key si fara acces la contul personal YouTube al administratorului. La `/youtube subscribe`, botul rezolva channel ID-ul, marcheaza drept baseline numai videoclipurile mai vechi de o luna si lasa continutul recent eligibil pentru prima `/youtube notify on`. Dupa prima activare, continutul aparut cat timp notificarile sunt oprite este revendicat fara livrare, ca reactivarea sa nu creeze backlog. Cron-ul grupeaza abonamentele dupa channel ID, citeste fiecare feed o singura data per ciclu si distribuie rezultatele catre guild-urile interesate.

Deduplicarea este atomica in colectia `guildSeenYoutube`, pe combinatia server + canal YouTube + ID video. Schimbarea titlului sau a thumbnail-ului nu retrimite acelasi ID; un reupload cu ID nou este continut nou. Un videoclip este revendicat inainte de trimitere si revendicarea este anulata daca metadatele sau toate destinatiile de livrare esueaza, astfel incat ciclul urmator sa poata reincerca. Cand outbox-ul este activ, joburile folosesc `kind: youtube`, sunt revalidate pe `youtubeNotificationsEnabled` si pe canalul principal sau una dintre rutele speciale, iar `notificationHistory` este scris numai dupa livrarea reala.

Filtrele Shorts/live/premiere necesita o citire a paginii videoclipului. Filtrul de durata minima este fail-closed: daca este configurat peste `0` si durata nu poate fi determinata, videoclipul nu este trimis. Filtrul inclusiv de titlu accepta un videoclip daca titlul contine cel putin una dintre valorile configurate. Sablonul mesajului permite numai `{channel}`, `{title}` si `{url}`, iar payload-ul dezactiveaza mentiunile Discord. Livrarea automata si manuala trimite maximum 5 videoclipuri per mesaj si asteapta 10 minute intre loturile suplimentare.

Diagnostic recomandat:

1. `/youtube status` pentru configurarea completa si ultima verificare.
2. Verifica permisiunile botului direct pe canalul Discord configurat.
3. Verifica ultimele erori de feed, metadate sau livrare in `/maintenance`, alertele admin si colectia `guildYoutubeErrors`.
4. Verifica accesul outbound HTTPS catre `www.youtube.com`, `youtube.com/feeds/videos.xml` si `i.ytimg.com`.
5. Dupa remediere, `/youtube clear-errors` curata istoricul operational.

Un canal Discord principal sters sau devenit permanent inaccesibil dezactiveaza notificarile YouTube pentru guild. O ruta speciala invalida este eliminata fara sa dezactiveze celelalte destinatii. Daca un canal YouTube nu mai are rute speciale, livrarea revine la canalul principal.

## Operare notificari DLC (`checkForDlcs`)

Motorul DLC (`checkForDlcs`) ruleaza in ciclul cron pe aceeasi lista globala de jocuri ca `checkForUpdates`. Per ciclu, pentru fiecare joc cu `appId`, botul citeste o singura data pagina de magazin Steam prin `fetchGameDlcs`, cu o concurenta mica de preluare; un joc cu status `age-gate`, `parse-error` sau `unavailable` este sarit, restul continua. Moneda implicita a instantei este convertita in codul de tara Steam (`cc=`) prin `currencyToSteamCountry` (ex. `EUR` -> `de`, `RON` -> `ro`, necunoscut -> `us`), fiindca Steam asteapta cod de tara, nu cod de valuta. Fiecare guild abonat (`dlcSubscribed`, cu `dlcChannelId` valid si care nu este in curs de initializare) primeste apoi notificari doar pentru DLC-urile care ii sunt inca nevazute. Livrarea DLC foloseste trimitere directa (nu outbox), cu exact-once garantat de revendicarea atomica `claimSeenDlc` + rollback la esec.

Deduplicarea este atomica in colectia `guildSeenDlc`, pe combinatia server + `gameKey` + `dlcKey`. `dlcKey` este `appId`-ul numeric al DLC-ului cand exista, altfel o cheie stabila derivata din nume, astfel incat un DLC fara appId sa nu fie renotificat la fiecare ciclu. Cheia de deduplicare in memorie (`dlcSeenDedupKey`) foloseste o codificare structurala fara coliziuni (`JSON.stringify([gameKey, dlcKey])`) - nu un delimitator brut care ar putea produce coliziuni sau bytes NUL literal in sursa. Un gate CI (`check-no-nul-bytes`) refuza orice byte `0x00` in fisierele text urmarite, ca fisierele sursa sa ramana text cautabil de git/ripgrep/linters. Un DLC este revendicat inainte de trimitere; daca trimiterea esueaza tranzitoriu, revendicarea este anulata (rollback) ca ciclul urmator sa reincerce, iar un cod permanent Discord opreste notificarile DLC pentru guild si seteaza `dlcLastError`.

La `/start dlc`, `seedBaselineDlc` preia catalogul curent de DLC-uri pentru toate jocurile si il marcheaza ca vazut fara sa trimita notificari, ca activarea sa nu genereze backlog. Baseline-ul este fail-safe: daca **oricare** sursa obligatorie esueaza (`unavailable`/`parse-error`/`age-gate`), `seedBaselineDlc` arunca, iar activarea se opreste cu `baseline-failed` (rollback prin `activationId`) in loc sa finalizeze cu o harta partiala care ar anunta ulterior DLC-uri vechi ca noi. Motorul trimite cel mult `MAX_DLCS_PER_CYCLE` DLC-uri noi per guild per ciclu.

## Limite aliasuri de joc (`/game-alias`)

`/game-alias add` are doua plafoane, ca documentul guild-ului sa nu creasca nelimitat catre limita Mongo: **`MAX_ALIASES_PER_GAME`** (25 aliasuri per joc) si **`MAX_TOTAL_GAME_ALIASES`** (200 aliasuri per server). Verdictul prietenos (duplicat / plafon atins) se calculeaza din snapshot pentru mesaj, dar **plafonul e impus atomic in scriere**: `addGameAlias` foloseste un `findOneAndUpdate` cu **pipeline de agregare** (`buildAddGameAliasPipeline`) care, in aceeasi operatie pe document, recalculeaza atat lungimea per-joc (`gameAliases.<gameKey>`) cat si totalul din toate cheile (`$objectToArray` + `$reduce`) si adauga aliasul doar daca `NOT deja prezent AND size < 25 AND total < 200`. Astfel doua adaugari concurente (pe acelasi joc sau pe jocuri diferite) nu pot depasi impreuna plafonul si niciuna nu pierde aliasul celeilalte — scrierea e serializata pe document, nu un `$set` peste un array recomputat dintr-un snapshot invechit; daca aliasul nu apare dupa update (o comanda concurenta a ocupat ultimul loc), comanda raporteaza cursa in loc de succes. `removeGameAlias` foloseste **`$pull` doar pe `gameAliases.<gameKey>`** — atinge exclusiv cheia jocului, deci un remove concurent pe alt joc nu mai clobbereaza tot obiectul `gameAliases`; `modifiedCount === 0` inseamna ca aliasul nu exista. Cursele reale sunt acoperite de `gameAliasAtomic.integration.test.ts` (Promise.all pe Mongo real). **Nota Mongoose 9:** update-urile cu pipeline de agregare (aici, dar si `priceAlert`, `lock-channel`, limitele YouTube, future-release, watchlist, moderare) necesita optiunea `updatePipeline`; de aceea boot-ul apeleaza global `mongoose.set("updatePipeline", true)` in `app/bootstrap.ts`, altfel Mongoose 9.7+ arunca „Cannot pass an array to query updates" la runtime pentru toate aceste comenzi. `/games` segmenteaza in bucati o linie de joc care singura depaseste bugetul unui mesaj Discord, in loc sa o trunchieze.

## Watchlist player-count (semantica implicita)

Convenția watchlist-ului este uniformă: `enabledGames` **absent sau gol** înseamnă watchlist-ul implicit — toate jocurile configurate cu Steam appId; un `enabledGames` ne-gol urmărește numai subsetul explicit. `resolveWatchedGames` aplică regula la `/start player-count` (un server cu `enabledGames: []` pornește și urmărește toate jocurile eligibile), iar `watchlistGameFilter` o aplică în interogările cron de snapshot/notificare și în update-urile de stare/milestone (`$or` pe joc explicit / array gol / câmp absent), astfel încât aceleași servere să fie selectate de cron și să primească o singură alertă la o schimbare semnificativă. `/stop` oprește notificările fără să golească watchlist-ul utilizatorului.

## Notificari future-release (praguri 30/7/1)

Pragurile calendaristice (30, 7, 1 zile inainte de lansare) se trimit cel mult o data. Politica pentru tick-uri ratate: cand un ciclu intarziat trece simultan peste mai multe praguri nenotificate (ex. de la 31 la 6 zile), se trimite **un singur** mesaj — pragul cel mai apropiat inca util (7) — iar pragurile mai vechi sarite (30) sunt marcate `notifiedThresholdDays` fara mesaj. Marcarea e atomica, deci un restart nu retrimite pragurile sarite. Dupa lansare (`remaining < 0`) nu se mai trimite niciun prag calendaristic. Tranzitiile preorder (disponibil / pret schimbat / retras) sunt independente de praguri.

## Politica pragului la `/add price-alert`

Pragul de pret acceptat de `/add price-alert` are o singura sursa de adevar: constantele `PRICE_ALERT_MIN_THRESHOLD` (0.01) si `PRICE_ALERT_MAX_THRESHOLD` (10000) din `priceAlertRepository`. Aceleasi constante sunt folosite in doua locuri care altfel ar putea aluneca separat: `setMinValue`/`setMaxValue` din definitia slash (limita afisata clientului Discord) si validarea defensiva din handler (`isValidPriceAlertThreshold`, plasa de siguranta daca API-ul e apelat direct, in afara clientului). Un test anti-drift verifica faptul ca `min_value`/`max_value` din definitia construita coincid exact cu constantele, deci o schimbare a limitei intr-un singur loc pica CI-ul in loc sa produca o comanda care accepta in client valori pe care handler-ul le respinge. Limita per server ramane `MAX_PRICE_ALERTS_PER_GUILD` (25), aplicata atomic in pipeline-ul de upsert.

`/price-alert list` reflecta livrabilitatea atat in antet, cat si **per alerta**: cand modulul nu e livrabil (`discountsSubscribed`/`discountChannelId` lipsesc), o alerta ne-declansata nu mai e afisata drept `armata` ci `inactiva (pana la /start reduceri)`; o alerta declansata ramane `declansata, asteapta rearmare`. Cand livrarea e activa, alertele ne-declansate revin la `armata`. Astfel starea afisata nu mai contrazice starea reala a livrarii.

## Paginare recuperabila la liste

`/list suggest-command` nu mai taie continutul la bugetul de caractere: intrarile sunt randate cate una pe linie si paginate (`paginateTextLines`), prima pagina prin editarea raspunsului si restul prin `followUp` ephemeral, astfel incat fiecare sugestie salvata sa fie vizibila printr-o succesiune finita de pagini (`numar` controleaza cate intrari sunt aduse, pana la `MAX_SUGGESTED_COMMANDS`). Nicio intrare nu mai este ascunsa doar fiindca descrierile sunt lungi.

Aceeasi paginare recuperabila se aplica acum si listelor `/watchlist show`, `/future-release list`, `/youtube list`, `/youtube channel-route list` si `/youtube title-filter list`: fiecare intrare este randata pe o linie si impartita in pagini (`sendPaginatedEdit` pentru comenzile care folosesc `allowedMentions`, respectiv `sendYouTubePages` pentru comenzile YouTube care marcheaza ephemeral prin `flags`), prima pagina prin editarea raspunsului si restul prin `followUp`. Paginile administrative raman **ephemeral**, iar `/future-release list` ramane **publica** (ephemeral doar la eroare). Headerul si starea modulului stau pe prima pagina, iar limitele de stocare (`MAX_PRICE_ALERTS_PER_GUILD`, 20 future-release, limitele YouTube) si mesajele pentru lista goala raman neschimbate. Nicio intrare salvata nu mai este ascunsa doar fiindca lista depaseste bugetul unui mesaj Discord.

Aceeasi paginare acopera acum si restul inventarelor: `/price-alert list`, `/backup list`, `/backup preview`, `/game-alias list` (prin `sendPaginatedEdit`) si `/admin-command-access list` (prin `sendPaginatedEditFlags`, varianta cu ephemeral prin `flags`). In plus, `paginateTextLines` **sparge in segmente** o intrare individuala mai lunga decat bugetul unui mesaj, in loc sa o trunchieze — deci nici macar o singura linie supradimensionata nu mai pierde continut.

## Jurnal de operatii (crash-recovery, `operationJournal`)

Operatiile care ating mai multe documente/colectii (ex. `/reset-config`: reset configuratie + audit +
curatare erori YouTube + curatare dead-letter) NU pot fi atomice pe Mongo standalone (fara replica set,
deci fara tranzactii). Ca sa nu ramana stare partiala (configuratie resetata dar audit lipsa) la o eroare
mid-operatie, aceste operatii sunt **jurnalizate**: inainte de executie se scrie o intrare `pending` in
colectia `operationJournal` (cu `kind`, `payload`, `schemaVersion`, `resourceKey` si o versiune monotona
a resursei), se ruleaza executorul **idempotent**, apoi intrarea se marcheaza `done`.

- **Recovery la boot si periodic.** Dupa migrari si apoi la fiecare minut, botul ruleaza `recoverPending`: reia orice intrare ramasa `pending`
  mai veche de **5 minute** (pragul evita furtul unei operatii in-flight a altei instante) si o re-executa
  idempotent, apoi o marcheaza `done`. O operatie cu versiune mai veche decat alta intentie pentru aceeasi
  resursa devine `superseded` si nu este reaplicata.
- **Idempotenta executorului.** Corpul foloseste `runMongoWrite`: pasii **critici** (mutatia + auditul)
  propaga eroarea (intrarea ramane `pending` -> se reia la recovery), iar **curatarile** incidentale sunt
  best-effort (logate, ne-blocante) — un esec de curatare nu mai lasa auditul nescris.
- **Lease si retry.** Executorul reinnoieste `lockedUntil` prin heartbeat. Dupa 5 incercari operatia devine
  `failed`; un `kind` necunoscut sau un `schemaVersion` incompatibil devine direct `failed`.
- **Curatare.** Un TTL partial pe starile `done`, `superseded` si `failed` sterge intrarile terminale (retinute scurt
  pentru observabilitate). O intrare care ramane `pending` mult timp inseamna o operatie care esueaza
  repetat la recovery — verifica log-urile `OP_JOURNAL` si disponibilitatea Mongo.

Adaugarea unei noi operatii multi-document jurnalizate = un nou `kind` + un executor idempotent inregistrat
in `operationJournalRuntime.ts`.

## Indexuri MongoDB (inventar)

Index-urile sunt declarate in `src/infra/mongo/models.ts` si construite automat de Mongoose la
pornire (`autoIndex` implicit activ). Verificarea statica `npm run check:db-indexes` confirma ca
fiecare index e pe un camp real din schema, ca nu exista declaratii duplicate si ca fiecare colectie
de mai jos e documentata aici; daca un Mongo e disponibil (`MONGO_URI`), ruleaza si `syncIndexes()`
pe toate modelele — adica SINCRONIZEAZA efectiv index-urile serverului cu schema (creeaza-le pe cele
lipsa, sterge-le pe cele divergente) si prinde index-uri conflictuale/invalide; fara Mongo ramane
doar validarea statica. Nu exista un script separat de "sync": `check:db-indexes` cu `MONGO_URI`
setat ESTE sincronizarea. Inventarul declarat curent:

| Colectie | Cheie | Optiuni | Rol |
| --- | --- | --- | --- |
| `guilds` | `{ subscribed, notificationChannelId }` | — | enumerarea guild-urilor abonate la update-uri la dispatch |
| `guilds` | `{ discountsSubscribed, discountChannelId }` | — | enumerarea guild-urilor abonate la reduceri |
| `guilds` | `{ youtubeNotificationsEnabled, youtubeNotificationChannelId }` | — | enumerarea guild-urilor cu monitorizarea YouTube activa |
| `guildSeenDiscounts` | `{ guildId, dealHash }` | unique | dedup per-guild al reducerilor deja trimise |
| `guildSeenDiscounts` | `{ seenAt }` | TTL `GUILD_SEEN_DISCOUNT_TTL_DAYS` (implicit 60 zile) | curatare automata a istoricului de reduceri vazute |
| `guildSeenUpdates` | `{ guildId, gameKey, updateId }` | unique | dedup per-guild al update-urilor deja trimise |
| `guildSeenYoutube` | `{ guildId, channelId, videoId }` | unique | claim si dedup atomic per-guild pentru videoclipurile YouTube |
| `guildSeenDlc` | `{ guildId, gameKey, dlcKey }` | unique | claim si dedup atomic per-guild al DLC-urilor deja notificate (baseline seed la `/start dlc`) |
| `guildYoutubeState` | `{ youtubeNotificationsEnabled, youtubeNotificationChannelId }` | — | enumerarea guild-urilor cu monitorizarea YouTube activa, dupa scoaterea starii YouTube din documentul `guilds` |
| `guildPlayerCountWatch` | `{ guildId, gameKey }` (unic) | — | starea de urmarire player-count per guild+joc, scoasa din array-ul `playerCountWatchState` de pe documentul `guilds`; indexul unic e cel care tine locul garzii `$ne` de dinainte |
| `guildPermissionRequests` | `{ guildId, status, requestedAt }`, `{ guildId, type, requesterId, status }` | `requestedAt` (180 zile) | cererile de aprobare de securitate pentru toate cele sase tipuri (bot-add, permission-grant, moderation-mass, webhook, server-structure, protected-resource-change), scoase din array-ul `botAddPermissions` de pe documentul `guilds`; un document per cerere face consumul aprobarii un compare-and-set pe `status`, nu un `arrayFilters` peste un array care creste |
| `guildProtectedResources` | `{ guildId, addedAt }`, `{ guildId, type }` | - | resursele marcate prin `/protected-resource`, cu snapshot-ul lor (nume, pozitie, parinte, permisiuni, overwrite-uri) si starea `degraded` cu cauzele exacte; `_id` este `guildId:resourceId`, deci acelasi ID de resursa pe doua servere nu se poate ciocni, iar o resursa nu poate fi protejata de doua ori |
| `guildMassModerationWindows` | `{ guildId, actorId }` | `updatedAt` (24 ore) | fereastra de 5 minute per guild+autor pentru subprotectia `moderation-mass`: kick-urile si ban-urile atribuite prin Audit Log, deduplicate dupa `auditId`. `_id` = `guildId:actorId`, deci doi moderatori nu isi amesteca contoarele. `sanctionedAt` e revendicat printr-un compare-and-set, deci o fereastra nu poate fi sanctionata de doua ori de doua instante |
| `guildWebhookSnapshots` | `{ guildId, capturedAt }` | - | snapshotul webhook-urilor per canal (`_id` = `guildId:channelId`), baza de comparatie pentru subprotectia `webhook` din `moderation-guard`: fara el, o creare/editare/stergere nu poate fi distinsa de starea legitima. Se rescrie dupa fiecare eveniment tratat, inclusiv cand poarta e oprita sau un raid e confirmat, ca baseline-ul sa urmeze realitatea |
| `guildRaidSnapshots` | `{ guildId, capturedAt }` | `capturedAt` (90 zile) | snapshotul versionat al serverului luat la trecerea in containment, inainte de primul lockdown (`_id` = ID-ul incidentului): canale cu overwrite-uri, roluri, webhook-uri, invitatii si starea celor sase protectii, plus planul de restaurare cu `status`/`attempts` per operatiune. Captura e un `$setOnInsert`, deci nu poate fi suprascrisa de o a doua incercare; planul e comparat cu starea curenta la recovery, ca schimbarile legitime facute de owner intre timp sa nu fie rescrise |
| `guildRaidIncidents` | `{ activeKey }` UNIC sparse, `{ guildId, stage, startedAt }`, `{ guildId, startedAt }` | `startedAt` (365 zile) | incidentele anti-raid cu ID-ul, etapa (`suspected` -> `confirmed` -> `containment` -> `cleanup` -> `recovery` -> `resolved`), participantii cu sanctiunile aplicate si esuate, canalele blocate cu starea dinainte de lockdown, actiunile ramase, erorile si progresul restaurarii; avansarea etapei e un compare-and-set pe `stage`, deci doua instante nu pot aplica aceeasi tranzitie de doua ori, iar la repornire incidentul activ e regasit fara sa repete sanctiunile. `activeKey` este `guildId` cat timp incidentul e activ si se sterge la `resolved`; indexul unic sparse pe el garanteaza un singur incident activ per server chiar daca doua instante il deschid simultan |
| `guildAdRequests` | `{ guildId, status, requestedAt }`, `{ guildId, requesterId, status }` | `requestedAt` (180 zile) | cererile de aprobare pentru reclame create prin `/ad-request`; aprobarea e legata de utilizatorul exact **si** de amprenta reclamei (text normalizat plus atasament), deci o modificare semnificativa a reclamei o invalideaza, iar consumul e un compare-and-set pe `status`, de unica folosinta |
| `guildAdAttempts` | `{ guildId, strikes }`, `{ guildId, userId }` | - | contorul de tentative per utilizator, cu `_id` = `guildId:userId`. Ciclul e 1/3 -> 2/3 -> warn automat, dupa care `strikes` revine la 0 dar `totalDeleted`, `totalWarns` si istoricul raman; incrementul foloseste un filtru `strikes < 2`, deci doua mesaje trimise simultan nu pot ocoli warn-ul |
| `guildSecurity` | `{ threatProtectionEnabled, threatAlertChannelId }` | — | enumerarea guild-urilor cu protectia de amenintari activa, dupa scoaterea starii de securitate din documentul `guilds` |
| `guildSecurity` | `{ newAccountAlertsEnabled, newAccountAlertChannelId }` | — | enumerarea guild-urilor cu alertele de cont nou active |
| `guildAuditLogs` | `{ guildId, kind, at }` | — | listarea audit-ului `/bot-log` (`kind: "bot"`) si `/server-log` (`kind: "server"`), cele mai noi primele, cu interval si offset |
| `guildAuditLogs` | `{ at }` | TTL `GUILD_AUDIT_LOG_TTL_DAYS` (implicit 180 zile) | retentia audit-ului admin; inlocuieste vechiul cap de 100 de intrari per array din documentul guild (intrarile expira dupa timp, nu dupa numar) |
| `guildConfigBackups` | `{ guildId, name }` | unique | un backup de configuratie per nume per guild; `/backup add` cu acelasi nume suprascrie (upsert), `/backup preview|load|delete` cauta direct pe cheia naturala |
| `guildConfigBackups` | `{ guildId, createdAt }` | — | listarea `/backup list` cele mai noi primele si evictia celor mai vechi backup-uri peste capul de 20 per guild la salvare |
| `guildSuggestedCommands` | `{ guildId, commandName }` | unique | o sugestie de comanda per nume per guild; `/suggest-command add` cu un nume existent pastreaza intrarea originala (`$setOnInsert`), `/suggest-command delete` sterge pe cheia naturala |
| `guildSuggestedCommands` | `{ guildId, createdAt }` | — | listarea `/suggest-command list` cele mai noi primele si evictia celor mai vechi sugestii peste capul de 100 per guild la salvare |
| `guildYoutubeErrors` | `{ guildId, at }` | — | jurnalul de erori YouTube per guild: cele mai noi primele, numaratoarea din `/youtube status` si `/maintenance`, evictia celor mai vechi erori peste capul de 20 per guild la inregistrare |
| `guildDeadLetters` | `{ guildId, failedAt }` | — | auditul dead-letter per guild: cele mai noi primele, numaratoarea din `/maintenance`, stergerea la replay intern sau `/reset-config`, evictia celor mai vechi intrari peste capul de 50 per guild la inregistrare |
| `notificationOutbox` | `{ availableAt, lockedUntil }` | — | claim-ul joburilor disponibile la drenare |
| `notificationOutbox` | `{ dedupeKey }` | unique, sparse | impiedica doua joburi pending cu acelasi `dedupeKey` (sparse: joburile fara cheie coexista) |
| `notificationOutbox` | `{ statusChangedAt }` | TTL (NOTIFICATION_OUTBOX_SENT_TTL_HOURS), partial pe `status` in {delivered, dead-lettered, dropped} | curata automat joburile finalizate pastrate pentru observabilitate (masina de stari explicita) |
| `notificationOutbox` | `{ createdAt }` | TTL 7 zile, partial pe `status` in {queued, leased} | plasa de siguranta pentru joburile care nu au ajuns la livrare; `delivered-pending` este pastrat pana la finalizarea persistentei |
| `notificationOutboxSent` | `{ dedupeKey }` | unique | istoricul de livrari pentru dedup la recovery |
| `notificationOutboxSent` | `{ sentAt }` | TTL `NOTIFICATION_OUTBOX_SENT_TTL_HOURS` (implicit 24h) | expirarea istoricului de dedup |
| `notificationHistory` | `{ guildId, sentAt }` | TTL `NOTIFICATION_HISTORY_TTL_DAYS` (implicit 30 zile) | istoricul intern al notificarilor livrate efectiv per server; scris dupa send-ul real (cu outbox: la livrarea din coada, nu la enqueue) |
| `notificationHistory` | `{ guildId, dedupeKey }` | unique, partial (`dedupeKey > ""`) | idempotenta istoricului: o re-livrare/recovery a aceleiasi notificari nu adauga un al doilea rand (upsert pe `dedupeKey`) |
| `feedbackReports` | `{ guildId, createdAt }` | TTL `FEEDBACK_REPORT_TTL_DAYS` (implicit 90 zile) | rapoartele trimise de utilizatori prin comanda `/report` |
| `notificationDeadLetterReplay` | `{ updatedAt }` | TTL `NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS` (implicit 7 zile) | expira payload-ul de replay; `updatedAt` se reimprospateaza la fiecare re-record, deci TTL se masoara de la ultimul dead-letter |
| `notificationDeadLetterReplay` | `{ guildId, createdAt }` | — | listare FIFO interna a payload-urilor de replay per server |
| `notificationDeadLetterReplay` | `{ guildId, dedupeKey }` | unique, partial (`dedupeKey != ""`) | dedup la re-record (replay esuat -> re-dead-letter nu acumuleaza duplicate) |
| `operationJournal` | `{ status, updatedAt }` | — | recuperarea la boot si periodica a operatiilor jurnalizate `pending` sau cu lease expirat |
| `operationJournal` | `{ resourceKey, resourceVersion }` | — | identifica intentia cea mai noua pentru o resursa si previne reaplicarea unei operatii vechi peste ea |
| `operationJournal` | `{ updatedAt }` | TTL 1 zi, partial pe `status` in {done, superseded, failed} | curata automat intrarile terminale pastrate scurt pentru observabilitate |
| `joblocks` | `{ lockedUntil }` | — | gasirea/expirarea lock-urilor distribuite (cron/outbox) |
| `adminalertcooldowns` | `{ lastSentAt }` | TTL 7 zile | cooldown per-alerta pentru admin alerts |
| `fetchsnapshots` | `{ fetchedAt }` | TTL 1 zi | event store pe fetch (hidratare cache la boot) |
| `playerCountSnapshots` | `{ fetchedAt }` | TTL 1 zi | snapshot periodic de player-count per appId (scris de cron, citit de `/top active games` si `/player-count`); jocurile scoase din configuratie expira automat |
| `playerCountHistory` | `{ fetchedAt }` | TTL 31 zile | retentia punctelor periodice folosite de trend, gainers si peak-time |
| `playerCountHistory` | `{ appId, fetchedAt }` | — | citirea cronologica a istoricului pentru un Steam appId |
| `playerCountHistory` | `{ gameKey, fetchedAt }` | — | interogari operationale pe cheia jocului si interval |
| `reviewTrendSnapshots` | `{ fetchedAt }` | TTL 45 zile | retentia esantioanelor Steam folosite pentru trend si detectia review-bombing cu volum minim |
| `reviewTrendSnapshots` | `{ appId, fetchedAt }` | - | citirea cronologica a review-urilor pentru un Steam appId |
| `reviewTrendSnapshots` | `{ gameKey, fetchedAt }` | - | interogari operationale pe cheia jocului si interval |
| `dealPriceSnapshots` | `{ fetchedAt }` | TTL 400 zile | retentia istoricului de pret folosit de `/deal-score` |
| `dealPriceSnapshots` | `{ gameKey, store, currency, fetchedAt }` | - | comparatia cronologica si minimul istoric pentru aceeasi oferta si valuta |
| `newAccountAlertDeliveries` | `{ expiresAt }` | TTL la momentul din document | elibereaza automat claim-urile de deduplicare dupa fereastra de alerta |
| `newAccountAlertDeliveries` | `{ guildId, userId }` | unique | claim comun scanarii initiale si evenimentului live; impiedica alerta dubla pentru acelasi membru |
| `newAccountAlertDeliveries` | `{ status, sendingAt }` | — | reconcilierea la pornire a trimiterilor ramase in starea `sending` (stare nedeterminata dupa outage Mongo) |
| `channelLockRecoveries` | `{ expiresAt }` | TTL la momentul din document | retentia inregistrarilor de divergenta lock/unlock (30 zile) |
| `channelLockRecoveries` | `{ guildId, channelId }` | unique | o singura inregistrare de recovery per canal, reincercata idempotent pana la convergenta |
| `channelLockRecoveries` | `{ createdAt }` | — | procesarea in ordinea aparitiei de catre worker-ul de recovery |
| `bugReports` | `{ guildId, dedupeKey }` | unique | deduplicarea atomica a rapoartelor de bug in interiorul serverului |
| `bugReports` | `{ guildId, createdAt }` | — | listarea paginata a bug-urilor, cele mai noi primele |
| `userComplaints` | `{ guildId, dedupeKey }` | unique | deduplicarea atomica a reclamatiilor in interiorul serverului |
| `userComplaints` | `{ guildId, createdAt }` | — | listarea paginata a reclamatiilor, cele mai noi primele |

Cand adaugi/modifici un index in `models.ts`, actualizeaza tabelul de mai sus — altfel
`check:db-indexes` esueaza (Regula: codul reflectat in documentatie).

### Formatul cheii de dedup pentru istoricul notificarilor

`dedupeKey` din `notificationHistory` este versionat: `history:v1:<sha256>`, unde `<sha256>` e
hash-ul peste identitatea structurata a notificarii (`kind`, `gameKey`, `link`, `title`, `itemId` =
`updateId`/`dealHash`). Prefixul de versiune izoleaza explicit formatul, ca o schimbare viitoare de
algoritm/inputuri sa fie `history:v2:...` si sa nu coliziona cu cheile vechi.

O schimbare de format **nu produce duplicate de NOTIFICARI** — dedup-ul de trimitere e separat si
neafectat (colectiile `guildSeenUpdates`/`guildSeenDiscounts` + `notificationOutboxSent`). Singurul
efect posibil este, **doar in fereastra unui deploy** in care exista re-livrari/recovery ale aceleiasi
notificari fix peste momentul schimbarii de format, **una-doua intrari duplicate in istoricul intern** pentru
aceeasi livrare (cheile vechi si cele noi nu se mai recunosc reciproc). Acestea **expira automat** prin
TTL-ul `notificationHistory` (implicit 30 zile), deci nu e necesara o migrare a istoricului. Daca vrei un
istoric perfect curat imediat dupa o schimbare de format, fa o migrare unica (recalculeaza `dedupeKey`
sau golesti colectia) — altfel, fereastra se inchide singura.

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
3. Daca e backlog temporar, lasa worker-ul sa-l goleasca; reincercarile sunt reprogramate automat cu backoff.

## Diagnostic per server: `/maintenance`

`/maintenance` (ephemeral, admin) genereaza un raport de sanatate per guild din `buildMaintenanceReport`. Pe langa outbox, dead-letter, pauza de drenare, backup-ul de configuratie si erorile YouTube, raportul verifica un **inventar declarativ de module** (`MAINTENANCE_MODULES`): fiecare modul are un camp de activare, un camp de canal si, optional, un camp de ultima eroare. Un modul activ fara canalul configurat apare la linia `canale notificari`, iar linia `notificari` semnaleaza `ATENTIE` doar cand niciun modul din inventar nu este activ.

Inventarul acopera: update-uri (`subscribed`/`notificationChannelId`/`updatesLastError`), reduceri (`discountsSubscribed`/`discountChannelId`/`discountsLastError`), YouTube (`youtubeNotificationsEnabled`/`youtubeNotificationChannelId`), future-release (`futureReleaseSubscribed`/`futureReleaseChannelId`), DLC (`dlcSubscribed`/`dlcChannelId`/`dlcLastError`), player-count (`playerCountSubscribed`/`playerCountChannelId`), alerte cont nou (`newAccountAlertsEnabled`/`newAccountAlertChannelId`), protectie amenintari (`threatProtectionEnabled`/`threatAlertChannelId`) si protectie adaugare boti (`botAddProtectionEnabled`/`botAddAlertChannelId`). La adaugarea unui modul nou de notificare/protectie, extinde inventarul cu o singura intrare, ca `/maintenance` sa nu ramana in urma fata de comportamentul real.

## Mentenanta: oprirea temporara a drenarii

Pentru interventii (canal in remediere, migrare, debugging), opreste controlat instanta botului din orchestratorul de deploy. Joburile raman persistate in Mongo si worker-ul reia drenarea dupa restart.

## Cand activezi / dezactivezi recovery-verify

- **Activeaza** (`on`) pe servere unde duplicatele sunt inacceptabile si canalul de
  notificari e aglomerat (risc real de reluari dupa restart). Costa un footer vizibil pe
  fiecare embed + un fetch de mesaje la fiecare recovery. Asigura **Read Message History**.
- **Dezactiveaza** (`off`, implicit) cand vrei zero overhead vizual/IO si te bazezi pe
  lease + istoricul de dedupe (suficient pentru majoritatea cazurilor).
- Se configureaza global cu `NOTIFICATION_OUTBOX_RECOVERY_VERIFY`; configuratiile per-server existente raman compatibile la citire.
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
dead-letter (colectia dedicata `guildDeadLetters`, plafonata la 50 per guild). Inspecteaza colectia si alertele admin.
Daca `bot_outbox_dead_lettered` creste, verifica permisiunile canalului si starea Discord;
dupa remediere, livrarile noi vor reusi (intrarile dead-letter raman pentru audit).

Dupa ce ai investigat si ai remediat cauza (ex. permisiuni de canal), un operator poate **re-trimite**
livrarile esuate prin fluxul intern de replay, care reintroduce in coada fiecare livrare
dead-letter pentru care exista un **payload stocat** (colectia `notificationDeadLetterReplay`,
populata doar pe calea outbox la dead-letter, cu TTL `NOTIFICATION_DEAD_LETTER_REPLAY_TTL_DAYS`,
implicit 7 zile) si curata intrarile re-introduse din lista de audit. Necesita
`NOTIFICATION_OUTBOX_ENABLED=true`. Nu se reiau livrarile cu motiv `delivered-marksent-failed`
(au fost deja trimise — re-trimiterea ar duplica) si nici cele al caror payload a expirat prin TTL.
Daca o reintroducere pica la mijloc, cele reusite sunt deja scoase din dead-letter, iar restul raman
in dead-letter pentru o reluare dupa verificarea cauzei.

Daca preferi sa nu re-trimiti, pastreaza intrarile pentru audit pana la expirarea politicii de retentie; sunt singura urma a livrarilor esuate.

Drenarea proceseaza fiecare job in pasi expliciti: **claim** (lease atomic) -> **validate**
(dedupe pe `notificationOutboxSent`, expirare aproape de TTL, abonarea guild-ului, apoi forma
payload-ului) -> **deliver** -> **persist delivery accepted** -> **history + markSent** ->
**finalize** (sau **retry** cu backoff / **dead-letter**). Persistarea acceptarii seteaza
`deliveryAcceptedAt` pe job prin acelasi token compare-and-set. Daca procesul cade dupa livrarea
Discord, jobul ramane `delivered-pending`; la reluare nu mai este trimis catre Discord, ci sunt
reluati numai pasii de persistenta ramasi. Astfel fereastra send -> markSent nu mai produce
re-livrare dupa crash.

**Proprietarul lease-ului (compare-and-set).** La claim, `findOneAndUpdate` seteaza `lockedBy`
(id-ul workerului) si incrementeaza `leaseVersion` (`$inc`), iar jobul revendicat poarta aceste
valori ca token de lease. TOATE tranzitiile ulterioare (`finalizeJob`, `scheduleRetry`, `deleteJob`)
filtreaza compare-and-set pe `{ _id, lockedBy, leaseVersion }` si verifica `modifiedCount`: daca
lease-ul a expirat si alt worker a reclamat jobul intre timp (alt `leaseVersion`), tranzitia
matcheaza 0 documente si NU suprascrie starea noului proprietar. Cazul e semnalat prin
`leaseLost` in rezultatul de drain + un log WARN. Astfel un drain lent nu mai poate finaliza sau
reprograma jobul unui alt worker (marker-ul de dedupe din `notificationOutboxSent` previne oricum
livrarea dubla). `leaseVersion` nu necesita migrare: `$inc` pe un camp lipsa il aduce la 1 la primul
claim, iar docurile noi au default 0.
Pasul de validare muta in dead-letter, cu motivul `invalid-payload` (terminal, fara retry), joburile
al caror payload nu mai e un obiect trimisibil (ex. corupt la replay/serializare: `null`, string,
array) — un astfel de job nu ar putea fi livrat niciodata si altfel ar consuma incercari degeaba;
validarea e strict structurala, regulile Discord (embeds goale etc.) raman ale pasului `deliver`.

Joburile `queued` si `leased` au TTL de 7 zile pe `createdAt`. Ca sa nu fie sterse **tacut** de TTL
daca raman blocate (ex. outbox dezactivat/pe pauza mult timp, worker oprit), un sweep la fiecare
drenare muta in dead-letter numai aceste stari mai vechi decat `NOTIFICATION_OUTBOX_MAX_AGE_MS`
(implicit 6 zile, inainte de TTL), cu motivul `expired-near-ttl`, si incrementeaza
`bot_outbox_expired`. Starea `delivered-pending` este exclusa atat din sweep, cat si din TTL:
livrarea Discord a fost deja acceptata, iar jobul ramane disponibil pentru finalizarea prioritara
a istoricului si markerului de deduplicare. Alerta
`OutboxJobsExpired` (`increase(bot_outbox_expired[1h]) > 0`) semnaleaza conditia: investigheaza
de ce nu s-au drenat (outbox oprit, canal stricat, worker cazut) — joburile au un audit clar in
dead-letter, nu dispar fara urma.

## Politica de atomicitate pentru operatiile critice

Regula generala: fiecare operatie critica este fie **o singura scriere Mongo atomica**
(pipeline/`$set`+`$unset` intr-un singur `updateOne`/`findOneAndUpdate`), fie o **unitate
logica jurnalizata si reluabila**. Jurnalul foloseste starile active `pending -> leased` si starile
terminale `done`, `superseded` sau `failed`, owner unic, `lockedUntil` si `leaseVersion`; numai
proprietarul lease-ului poate finaliza operatia, iar o alta instanta poate recupera un lease expirat.
Heartbeat-ul reinnoieste lease-ul cat timp executorul lucreaza. `schemaVersion`, limita de incercari si
versiunea monotona per `resourceKey` impiedica reluarea infinita sau aplicarea unei intentii vechi peste
una noua. Executorii sunt idempotenti, iar ID-ul jurnalului deduplica auditul. Tranzactiile Mongo NU sunt
folosite: ar cere replica set (indisponibil pe deployment-uri standalone) si — pentru
singurul flux unde ar parea utile (outbox) — nu ar acoperi riscul real, pentru ca send-ul
Discord nu e tranzactional (vezi paragraful dedicat drenarii de mai jos).

| Operatie | Mecanism | Fail-safe |
| --- | --- | --- |
| Livrare outbox | state machine claim->validate->deliver->deliveryAcceptedAt->history/markSent->finalize | un job `delivered-pending` reia numai persistenta, fara re-livrare Discord; toate tranzitiile verifica lease-ul compare-and-set |
| Backup restore (`/backup load`) | materializare resurse Discord lipsa -> validare referinte remapate -> operatie jurnalizata (update atomic snapshot + audit idempotent) | daca **validarea** post-materializare esueaza (referinte invalide/inexistente), resursele nou-create sunt **compensate** independent prin `rollbackMaterializedResources` (fiecare `delete` incearca separat; raporteaza cate au ramas de curatat manual), ca sa nu ramana canale/roluri orfane; esecul restaurarii jurnalizate (dupa validare) e reluabil idempotent prin jurnal, deci resursele create sunt intentionat pastrate pentru reluare, nu sterse (restaurarea Mongo si auditul nu sunt atomice, iar stergerea dupa un restore deja aplicat ar orfaniza configuratia) |
| Salvare/stergere backup | operatie jurnalizata + repository pe cheia naturala + audit idempotent | executorul poate fi reluat dupa crash fara backup sau audit duplicat |
| Reset configuratie | operatie jurnalizata: reset + audit + curatarea colectiilor operationale | orice esec critic lasa operatia `pending`; recovery-ul reia pasii idempotenti |
| `/youtube subscribe` | unitate logica: seed baseline seen -> salvare abonare prin pipeline atomic (`$cond` cu dedupe+limita) | esec la salvare sau limita ocupata concurent => rollback best-effort al baseline-ului (`removeSeenChannel`), logat daca pica |
| `/youtube unsubscribe` | UN `updateOne` cu `$pull` combinat (abonare + rute) | cache invalidat imediat; curatarea colectiei seen e best-effort dupa |
| Alerte de pret (declansare) | `claimTrigger` atomic (`$elemMatch` pe `triggeredAt: null`) | doua instante nu dubleaza alerta; esec de send => `rollbackOrReport` (re-armare + raportare daca rollback-ul pica) |
| Reguli admin-command-access | operatie jurnalizata; set/delete folosesc cheia canonica si audit idempotent | crash-ul dintre regula si audit este reparat de recovery; cheile vechi sunt curatate idempotent |
| Sugestii / watchlist-game / future-release | pipeline-uri atomice cu `$cond` (dedupe + limita in aceeasi scriere) | refuzul concurent e detectat din documentul intors si raportat userului |

De ce calea de succes a drenarii NU foloseste tranzactii Mongo (decizie, nu lipsa): scrierile
separate (`markSent` -> `delete`) sunt deja sigure fara tranzactie — daca `delete` esueaza dupa
`markSent`, urmatorul claim gaseste `dedupeKey` in istoricul `notificationOutboxSent` si sterge
jobul FARA re-livrare (pasul de validare), deci fereastra dintre cele doua scrieri nu poate
produce duplicat. Singurul risc real de duplicare (mesaj trimis pe Discord, apoi Mongo pica
inainte de `markSent`) nu poate fi acoperit de nicio tranzactie, pentru ca send-ul Discord nu
e tranzactional — pentru acel caz exista recovery-verify. O tranzactie ar cere si replica set
(indisponibil pe deployment-uri standalone) fara sa elimine niciun risc ramas.

## Sanatatea surselor (`/sources status`)

`/sources status` include un sumar de sanatate derivat din circuit breaker-ele per sursa (`CircuitBreakerModel`, cheie = jocul): cate surse sunt sanatoase, degradate (au esuat recent dar sub prag), in cooldown (breaker activ, sursa sarita temporar) sau cu schema-drift suspectat (HTTP OK dar 0 rezultate valide, probabil selectorii s-au schimbat). Sursele cu probleme sunt listate cu starea lor. Alertele administrative `cb:`/`drift:` semnaleaza deja intrarea in cooldown; comanda ofera imaginea de ansamblu la cerere.
