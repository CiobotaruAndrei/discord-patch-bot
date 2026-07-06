# Readiness de scalare — ce pregatim vs. ce amanam intentionat

Acest document raspunde la intrebarea „ce facem in loc de BullMQ / worker separat / dashboard / sharding / microservicii?". Pe scurt: **nu construim inca infrastructura grea; pregatim codul si documentam pragurile de declansare**, ca sa nu facem over-engineering inainte sa fie nevoie. Fiecare sectiune spune ce e deja gata, ce e amanat si care e semnalul care ar justifica pasul urmator.

## 1. In loc de BullMQ — cache Redis intr-un feature real (GATA)

Nu introducem inca o coada (BullMQ). In schimb, folosim conexiunea Redis optionala doar ca **cache**, intr-un singur feature real:

- Wrapper reutilizabil `src/infra/redis/redisCache.ts` (`getJson`/`setJson`/`deleteKey`), best-effort.
- Primul consumator real: cache-ul de player-count Steam (`src/features/player-count/cachedSteamPlayerCount.ts`, cheie `player-count:steam:<appId>`, TTL 60s).
- Fara `REDIS_URL` sau la orice eroare de Redis, se cade automat pe comportamentul actual (fetch live); Mongo ramane sursa de adevar.

Detalii complete in [`redis.md`](redis.md). Cand va aparea nevoia de joburi asincrone reale (retry-uri, esalonare, prioritati), abia atunci se evalueaza o coada — pana atunci, cache-ul acopera cazul concret fara complexitatea unei cozi.

## 2. In loc de worker separat — logica de job deja izolata in servicii testabile (GATA structural)

Nu pornim un proces worker separat si nu schimbam deployment-ul (`Dockerfile` ramane `node dist/app/main.js`). Logica de job este deja **extrasa in servicii testabile injectate**, care ruleaza in acelasi proces:

- `src/app/scheduler/cron.ts` + `cronJobRunner.ts` — ciclul cron (update-uri/reduceri/YouTube), cu deps injectate.
- `src/app/scheduler/outboxWorker.ts` — drenarea outbox-ului (rate limit, retry/backoff, dead-letter).
- `src/app/scheduler/housekeeping.ts` — curatarea cache-urilor.
- `src/features/player-count/playerCountSnapshotService.ts` — refresh-ul snapshot-urilor player-count.

Aceste servicii primesc dependentele prin factory (`create...`), deci sunt testabile fara proces separat si fara Discord/Mongo real. **Pentru a le muta pe viitor intr-un worker** ar trebui doar sa se extraga bucla de programare/executie (cine le porneste — `appRuntime`) intr-un entry-point separat, reutilizand aceleasi servicii; logica de job nu s-ar rescrie. Nu facem asta acum: nu exista inca volumul care sa justifice un proces in plus.

## 3. In loc de dashboard nou — observabilitate deja expusa (GATA)

Nu construim un UI de dashboard propriu. Semnalele exista deja si un dashboard extern (Grafana) se aseaza peste ele fara cod nou:

- `/metrics` (format Prometheus text) expune ~50 de serii `bot_*` (uptime, cron, fetch per sursa, outbox, cache, rate-limit, comenzi, Redis).
- `/healthz` + comanda Discord `/health` dau starea live (Mongo, gateway Discord, Redis).
- `monitoring/grafana-dashboard.json` si `monitoring/prometheus-alerts.yml` sunt deja in repo (vezi `monitoring/README.md`).

Un dashboard suplimentar inseamna doar panouri Grafana peste metricile existente — nu cod de aplicatie.

## 4. In loc de sharding — readiness note (AMANAT, cu prag clar)

Nu implementam `ShardingManager`. Sharding-ul Discord merita **doar cand numarul de guild-uri se apropie de limita de gateway** (in practica ~2500 de guild-uri per shard); sub acel prag ar fi prematur si ar complica inutil boot-ul si lifecycle-ul.

Semnal de declansare: numarul de guild-uri al botului. Cand se apropie de prag, pasul urmator este introducerea `ShardingManager` (proces manager + shard-uri), moment in care `main.ts`/`appRuntime.ts` devin punctul de adaptare (un shard = un `createAppRuntime`). Pana atunci, ramane un singur proces, iar aceasta nota tine minte pragul si locul unde s-ar face schimbarea.

## 5. In loc de microservicii — monolit cu boundaries clare (AMANAT, doar documentat)

Pastram monolitul. Nu cream servicii separate; documentam doar granitele modulare curente si ce ar putea deveni, teoretic, un serviciu separat in viitor:

- `src/app/` — compunerea runtime-ului, lifecycle, scheduler, health/metrics (orchestratorul).
- `src/infra/` — adaptoare de infrastructura: `http` (client/proxy/guard SSRF), `mongo` (conexiune/modele/locks/migratii), `redis` (conexiune/cache/metrici).
- `src/features/` — logica de produs pe domenii (comenzi, notificari/outbox, player-count, youtube, admin-records etc.).
- `src/sources/` — scraping si normalizare surse (Steam/Epic/listing/RSS) + registry.
- `src/shared/` — utilitare/tipuri comune; `src/native/` — addon Rust optional pentru hot-path.

Candidati teoretici de extras in viitor, **daca** vreodata ar fi nevoie: `sources/` ca serviciu de scraping independent si `features/notifications` + outbox ca serviciu de livrare. Granitele actuale (deps injectate, fara stare globala partajata dincolo de context-urile explicite) fac o astfel de separare posibila fara rescriere — dar ramane strict documentata, nu implementata.

## Rezumat

| Pas amanat | Ce facem in loc | Stare |
|---|---|---|
| BullMQ (coada) | cache Redis intr-un feature real (player-count) | gata |
| Worker separat | servicii de job testabile, in acelasi proces | gata structural |
| Dashboard | metrici `/metrics` + `monitoring/` Grafana/Prometheus | gata |
| Sharding | readiness note + pragul de declansare | amanat |
| Microservicii | boundaries documentate, monolit pastrat | amanat |
