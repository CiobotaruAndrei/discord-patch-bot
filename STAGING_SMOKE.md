# Staging smoke checklist (bot Discord real)

Testele automate (unit/functional/integrare/E2E) acopera logica, dar **nu** confirma
comportamentul live cu un token Discord real si un gateway real. Inainte de a promova o
versiune in productie, ruleaza manual acest checklist pe un server Discord de staging,
cu o aplicatie Discord dedicata (token separat de productie).

## Proba automata (`npm run smoke:staging`)

`npm run smoke:staging` (scriptul `scripts/stagingSmoke.ts`) este un runner automat care
verifica partea de infrastructura, complementar acestui checklist manual:

- daca `STAGING_BASE_URL` este setat, probeaza `GET /healthz` (asteapta `status: ok`,
  `mongo: 1`, `discord: ready`) si `GET /metrics` (asteapta prezenta metricilor cheie
  `bot_uptime_seconds`, `bot_fetch_success`, `bot_outbox_queue_depth`,
  `bot_native_fallback_total`); iese cu cod non-zero daca ceva esueaza;
- daca `STAGING_BASE_URL` lipseste, **esueaza (exit 1, fail-closed)**; pentru skip intentionat seteaza `ALLOW_STAGING_SMOKE_SKIP=true` (iese 0, artifact cu `skipped:true` — respins oricum de gate-ul de release);
- optional `STAGING_METRICS_TOKEN` pentru `/metrics` cand nu e public.

`npm run smoke:staging:discord` (scriptul `scripts/stagingDiscordSmoke.ts`) este o proba
**live Discord** automata care, daca sunt setate `STAGING_DISCORD_TOKEN`,
`STAGING_DISCORD_CLIENT_ID`, `STAGING_TEST_GUILD_ID` si `STAGING_TEST_CHANNEL_ID`:

- se autentifica cu token-ul real si asteapta `ready` (valideaza token + gateway);
- verifica prin REST ca slash command-urile sunt inregistrate (cel putin `ping` si `help`);
- verifica permisiunile botului pe canalul de test (ViewChannel / SendMessages / EmbedLinks /
  ReadMessageHistory);
- daca `STAGING_DISCORD_SEND_TEST=true`, trimite un embed real pe canal si il sterge imediat; daca testul de trimitere e cerut dar canalul nu e text-based sau nu are functia `send`, proba adauga un check `send` esuat explicit (nu mai poate iesi verde fara sa testeze trimiterea reala)
  (valideaza calea de notificare reala end-to-end).

Fara aceste credentiale **esueaza (exit 1, fail-closed)**; skip-ul intentionat cere `ALLOW_STAGING_SMOKE_SKIP=true`. Nu poate simula un utilizator care
*tasteaza* o slash command (ar necesita un cont/bot secundar), deci raspunsurile interactive
raman in checklist-ul manual de mai jos.

Ambele probe ruleaza periodic (saptamanal) si la cerere prin workflow-ul `Staging Smoke`
(`.github/workflows/staging-smoke.yml`, `workflow_dispatch` + `schedule`), folosind secretele de
repo (`STAGING_BASE_URL` / `STAGING_METRICS_TOKEN` pentru health/metrics; `STAGING_DISCORD_*`
pentru proba live). Vezi si `OPERATIONS.md` pentru interpretarea metricilor.

## Pregatire

- [ ] Aplicatie Discord separata de staging (token + client id proprii), invitata pe un
      server de test cu un canal dedicat.
- [ ] `.env` de staging: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `MONGO_URI` catre un Mongo
      de test (nu productia), `DISCORD_DEV_GUILD_ID` setat la serverul de test (propagare
      instant a slash-urilor).
- [ ] Addon-ul Rust este construit (`npm run build`); in `NODE_ENV=production` lipsa lui
      opreste boot-ul (vezi `ALLOW_NATIVE_FALLBACK`).

## Boot & health

- [ ] Botul porneste fara erori fatale; in log apare „logat ca <bot>".
- [ ] `GET /healthz` -> 200, `status: ok`, `mongo: 1`, `discord: ready`.
- [ ] `GET /metrics` raspunde (200 cu token sau `METRICS_PUBLIC=true`) si contine
      `bot_uptime_seconds`.

## Slash commands (in serverul de test)

- [ ] `/ping` raspunde `Pong!`.
- [ ] `/help` afiseaza meniul; `/games` listeaza jocurile.
- [ ] `/start updates` pe un canal -> confirmare; `/start reduceri` -> confirmare.
- [ ] `/latest updates`, `/latest reduceri`, `/latest pret <joc>`, `/dlc <joc>`,
      `/status <joc>` raspund corect (autocomplete functioneaza).
- [ ] `/set mode|mindiscount|maxprice|currency|stores|free|paid` salveaza si confirma.
- [ ] `/set outbox-recovery-verify on` -> daca botului ii lipseste *Read Message History*
      pe canal, raspunsul include avertismentul.
- [ ] Comenzile admin sunt refuzate pentru un membru non-admin.

## Notificari live (un ciclu real)

- [ ] Dupa `/start`, la urmatorul ciclu cron sosesc notificari reale in canal (embed-uri).
- [ ] Nu apar duplicate la al doilea ciclu (dedup `seen` functioneaza).
- [ ] Ping-ul de rol (daca e configurat prin `/set role ...`) apare doar pe primul mesaj.

## Outbox (daca `NOTIFICATION_OUTBOX_ENABLED=true`)

- [ ] `/outbox status` arata coada, dead-letter si starea recovery-verify.
- [ ] `/outbox permissions` raporteaza Send Messages / Embed Links / Read Message History.
- [ ] `/outbox pause` -> `bot_outbox_last_drain_age_seconds` incepe sa creasca; `/outbox resume`
      -> revine la valori mici.
- [ ] `/outbox drain-now` forteaza o drenare cand lock-ul e liber.

## Shutdown

- [ ] `SIGTERM` -> botul se opreste curat (drain shutdown), fara erori in log.

## Dupa rulare

- [ ] Nicio eroare neasteptata in log (doar WARN-uri cunoscute).
- [ ] Curata datele de test din Mongo-ul de staging daca e nevoie.
