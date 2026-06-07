# Monitoring

Reguli de alertare Prometheus si un dashboard Grafana, versionate in repo, pentru
metricile expuse de bot la `/metrics`. Pentru ce actiune iei la fiecare alerta, vezi
[`OPERATIONS.md`](../OPERATIONS.md).

## Fisiere

- `prometheus-alerts.yml` - reguli de alertare (grup `discord-patch-bot-outbox`) pentru:
  queue depth mare, vechimea celui mai vechi job, drenare invechita (`OutboxDrainStale`,
  pe baza `bot_outbox_last_drain_age_seconds`), mark-sent failures, recovery-verify
  failures, lock-acquire failures, dead-letter in crestere si marker-missing.
- `grafana-dashboard.json` - dashboard cu panouri pentru coada, latenta, throughput,
  semnale de esec si guild-uri cu recovery-verify activ.

## Prometheus

1. Asigura un scrape target catre endpoint-ul `/metrics` al botului (autentificat cu
   `METRICS_TOKEN` daca nu e `METRICS_PUBLIC`).
2. Adauga fisierul in `rule_files` din `prometheus.yml`:

   ```yaml
   rule_files:
     - /etc/prometheus/discord-patch-bot/prometheus-alerts.yml
   ```

3. Reincarca Prometheus (`SIGHUP` sau `/-/reload`). Pragurile (`> 100`, `> 600s`, etc.)
   sunt puncte de plecare; ajusteaza-le dupa volumul serverului (vezi OPERATIONS.md,
   sectiunea cu setari recomandate pe dimensiune).

## Calibrarea pragurilor (dupa rulare reala)

Pragurile din `prometheus-alerts.yml` (`> 100`, `> 600s`, `> 5`, etc.) sunt **valori de
plecare conservatoare**, nu adevaruri absolute: valoarea reala a alertelor apare doar dupa
ce le potrivesti pe traficul tau real. Un prag prea jos da alarme false (zgomot, oboseala de
alerta); unul prea sus rateaza incidente. Recalibreaza dupa **minim 1-2 saptamani** de rulare
in productie, cu acest proces per alerta:

1. **Stabileste baseline-ul.** In Grafana/Prometheus, uita-te la metrica pe 7-14 zile in regim
   normal (fara incident). Noteaza `p50`, `p95` si `max`. Exemplu pentru queue depth:
   `quantile_over_time(0.95, bot_outbox_queue_depth[7d])`.
2. **Alege pragul deasupra zgomotului normal, sub incident.** Regula practica:
   - Marimi de tip „nivel" (queue depth, oldest job age): prag ≈ `p95 × 1.5` … `× 2` din baseline,
     rotunjit. Daca `p95` e 40, un prag de `> 100` e sanatos; daca `p95` e deja 150, ridica-l.
   - Rate de eroare (`increase(...[w]) > N`): porneste de la `> 0` doar daca esecul e mereu
     anormal (ex. `mark_sent_failures`); pentru semnale care au un fundal benign mic
     (`recovery_marker_missing`) tine `N` peste fundalul observat in `increase(...[30d])`.
3. **Potriveste fereastra `for:`.** Cresc-o daca metrica e „spikey" si genereaza flapping
   (alerta apare/dispare); scade-o daca incidentele reale dureaza mai putin decat `for:` si
   alerta intarzie. Tinta: alerta sa traga la incident sustinut, nu la un spike de un ciclu.
4. **Valideaza retroactiv.** Inainte sa fixezi pragul, ruleaza expresia peste ultimul incident
   cunoscut (`...[30d]`) si confirma ca ar fi tras atunci, dar NU in zilele normale.
5. **Documenteaza si versioneaza.** Schimba pragul in `prometheus-alerts.yml`, comiteaza cu
   motivul (baseline observat) si reincarca Prometheus. Pragurile traiesc in repo, deci orice
   ajustare e revizuibila si reversibila.

Pana cand exista date reale, lasa valorile implicite — sunt calibrate sa prinda regresii
evidente fara sa presupuna un volum anume. Setarile recomandate pe dimensiune de server sunt in
[`OPERATIONS.md`](../OPERATIONS.md).

## Grafana

Importa `grafana-dashboard.json` (Dashboards -> Import) si alege data source-ul
Prometheus la prompt (variabila `datasource`).

## Note

Numele metricilor din aceste fisiere trebuie sa ramana sincronizate cu cele emise de
`app/health/httpServer.ts`. Un test de regresie (`test/monitoringRules.test.ts`)
esueaza daca o regula sau un panou refera o metrica `bot_*` care nu mai e emisa.
