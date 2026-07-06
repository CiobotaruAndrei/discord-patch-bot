# Redis — integrare optionala

Acest document descrie rolul Redis in bot si limitele lui actuale. Este un ghid de arhitectura, nu un tutorial de operare (pentru variabile vezi `README.md`, sectiunea Redis).

## Ce este Redis in botul acesta

Redis este o **conexiune optionala** catre un cache/coada extern, cablata in ciclul de viata al botului:

- `src/infra/redis/redisClient.ts` — `createRedisRuntime(env, logger)` construieste un `RedisRuntime` (`enabled`, `connect()`, `close()`, `status()`, `getClient()`). Fara `REDIS_URL` runtime-ul e dezactivat; cu `REDIS_URL` creeaza un client (`createClient({ url })`), asculta evenimentul `error` si expune conexiunea.
- `src/infra/redis/redisContext.ts` — un **singleton** construit din `env`+`logger` din `mongoContext`, partajat intre `main` (boot/shutdown) si contextul de comenzi, ca toata aplicatia sa vada aceeasi conexiune.
- Boot (`app/appRuntime.ts`): `redis.connect()` ruleaza dupa startup-ul Mongo si inainte de hidratarea cache-ului. Cu `REDIS_URL` setat, un esec de conectare opreste boot-ul fail-fast; fara `REDIS_URL`, `connect()` e un no-op cu log informativ.
- Shutdown (`app/lifecycle/shutdown.ts`): `redis.close()` (`quit()` doar daca e deschis) ruleaza dupa cron/outbox/housekeeping si inainte de Mongo/HTTP; o eroare de inchidere e doar logata (WARN), nu blocheaza shutdown-ul.
- Observabilitate: comanda `/health` afiseaza starea (`dezactivat`/`conectat`/`deconectat`), iar scriptul `npm run check:redis` verifica conexiunea (connect + `PING`) fara sa porneasca botul.

## Redis este optional momentan

Botul **nu depinde** de Redis. Fara `REDIS_URL` porneste si functioneaza normal; preflight-ul de env (`shared/envPreflight.ts`) doar avertizeaza, nu blocheaza. Redis serveste ca **accelerator**, nu ca sursa de adevar.

## Mongo ramane baza permanenta

MongoDB este singura persistenta durabila: configuratii per server, colectiile `seen` de deduplicare, outbox-ul de notificari, istoricul, circuit breaker-ele. Redis este destinat doar datelor **efemere si reconstruibile**:

- cache temporar cu TTL scurt (ex. rezultate de player-count, raspunsuri costisitoare);
- cooldown-uri si rate-limit partajate intre instante;
- pe viitor, o coada de joburi (vezi „Ce nu face inca").

Regula: daca o valoare nu poate fi pierduta fara consecinte, locul ei este in Mongo, nu (doar) in Redis.

## Cum setezi `REDIS_URL`

Redis se activeaza printr-o singura variabila de mediu, un URL `redis://` sau `rediss://`:

```env
REDIS_URL=redis://default:password@host:port
```

Pentru dezvoltare locala, pune linia in `src/.env` (fisier ignorat de git). Verifica rapid cu `npm run check:redis` (sau `node --env-file=.env dist/scripts/check-redis.js`).

## Ce sa NU faci

- **Nu hardcoda parola sau URL-ul Redis in cod.** Se citesc exclusiv din env / secret manager.
- **Nu urca `.env` pe GitHub.** Fisierul local `.env` este in `.gitignore`; in repo ramane doar placeholder-ul din `src/.env.example`.
- **Nu tine setari permanente doar in Redis.** Redis e un cache efemer; sursa de adevar este Mongo. Orice ai pune in Redis trebuie sa poata fi reconstruit din Mongo sau din surse externe.
- **Nu presupune ca Redis e mereu disponibil.** Codul care il foloseste trebuie sa cada gratios pe comportamentul fara Redis (fallback), fara sa strice comenzile existente.

## Ce nu face inca

Acest pas adauga doar conexiunea si utilitarele de baza. Nu sunt (inca) incluse: **BullMQ**, un **worker separat** de joburi, dashboard, sharding, lock-uri globale prin Redis sau microservicii. Aceste extensii sunt pasi ulteriori si vor fi documentate cand apar.
