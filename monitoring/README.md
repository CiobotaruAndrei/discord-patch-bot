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

## Grafana

Importa `grafana-dashboard.json` (Dashboards -> Import) si alege data source-ul
Prometheus la prompt (variabila `datasource`).

## Note

Numele metricilor din aceste fisiere trebuie sa ramana sincronizate cu cele emise de
`app/health/httpServer.ts`. Un test de regresie (`test/monitoringRules.test.ts`)
esueaza daca o regula sau un panou refera o metrica `bot_*` care nu mai e emisa.
