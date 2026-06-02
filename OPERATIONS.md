# Operare (runbook)

Ghid practic pentru operarea botului in productie, axat pe sistemul de notificari outbox.
Metricile sunt expuse la `/metrics` (Prometheus), iar comenzile admin `/outbox` ofera
vizibilitate si control direct din Discord.

Pe scurt, instrumentele de operare:

- Metrici Prometheus la `/metrics` (vezi README sectiunea health/metrics).
- Comenzi admin: `/outbox status | deadletters | retry | pause | resume | recovery-verify status`.
- Alerte admin (webhook): trimise automat la `recoveryFailures > 0` (`outbox:recovery-read`)
  si `markSentFailures > 0` (`outbox:mark-sent`).

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

## Cand creste `bot_outbox_recovery_verify_failures`

Recovery-verify e activ, dar botul nu poate citi istoricul canalului (de obicei lipseste
permisiunea **Read Message History**). In modul implicit (fail-open) mesajul se trimite oricum.

1. Vei primi si admin alert-ul `outbox:recovery-read`.
2. Acorda botului permisiunea **Read Message History** pe canalele de notificari/reduceri.
   `/set outbox-recovery-verify on` avertizeaza deja la activare daca permisiunea lipseste.
3. Daca duplicatele sunt foarte grave si preferi sa NU se trimita pana cand verificarea
   reuseste, porneste modul strict: `NOTIFICATION_OUTBOX_RECOVERY_STRICT=true` (fail-closed:
   reprogrameaza jobul cu backoff in loc sa trimita).

## Cand creste `bot_outbox_recovery_marker_missing`

Fetch-ul de istoric a reusit, dar marker-ul `dedupeKey` nu a fost gasit in ultimele mesaje,
deci mesajul a fost re-trimis. Diferit de `recovery_verify_failures` (acolo fetch-ul esueaza).

1. Daca valoarea e mica/sporadica, e normal — inseamna ca jobul chiar nu fusese livrat.
2. Daca e mare, marker-ul iese din fereastra de scanare pe canale aglomerate: creste
   `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` (implicit 25; max 100).

## Rate-limit Discord

Daca livrarile sunt incetinite de rate-limit:

1. Cresterea `bot_outbox_oldest_job_age_seconds` + `bot_outbox_queue_depth` fara erori
   indica throttling, nu esecuri.
2. Bot-ul respecta deja un token-bucket global la trimitere; nu forta drenarea agresiv.
3. Daca e backlog temporar, lasa worker-ul sa-l goleasca; pentru urgente punctuale,
   `/outbox retry` reprogrameaza joburile acestui server pentru livrare imediata.

## Mentenanta: pauza drenarii

Pentru interventii (canal in remediere, migrare, debugging) fara a opri tot botul:

- `/outbox pause` — opreste drenarea (global); joburile raman in coada, lock-ul nu e atins.
- `/outbox resume` — reia drenarea de unde a ramas.
- `/outbox status` arata starea (`Drenare: ACTIVA | PE PAUZA`).

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

## Dead-letter

Cand o livrare epuizeaza reincercarile sau primeste o eroare permanenta, intra in
dead-letter (pe documentul guild-ului, plafonat). Inspecteaza cu `/outbox deadletters`.
Daca `bot_outbox_dead_lettered` creste, verifica permisiunile canalului si starea Discord;
dupa remediere, livrarile noi vor reusi (intrarile dead-letter raman pentru audit).
