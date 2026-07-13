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

## Ownership pe multi-process (web/worker)

De cand botul poate rula impartit in `web` si `worker` (vezi `BOT_ROLE` in `README.md`), e nevoie de o politica clara despre ce traieste unde si cine invalideaza ce:

- **Sursa de adevar = Mongo, mereu.** Configuratii guild, colectiile `seen`, outbox, istoric, circuit breaker-e, snapshot-urile de player-count. Ambele procese scriu/citesc din Mongo; nimic durabil nu traieste doar in Redis.
- **Coordonarea (lock-uri) = Mongo, nu Redis.** Cron-ul si drain-ul outbox se coordoneaza intre procese prin lock-urile distribuite din Mongo (`acquireDbLock`/`renewDbLock`/`releaseDbLock`), **nu** prin Redis. Redis nu e folosit ca lock in acest moment; daca vreodata se adauga un lock prin Redis, va fi o decizie separata si documentata (Mongo ramane mecanismul de coordonare).
- **Cache efemer = Redis (best-effort), partajat intre procese.** Cache-ul (ex. `player-count:steam:<appId>`, TTL 60s) e scris/citit de oricine il atinge; fiind pe aceeasi instanta Redis, `web` si `worker` vad aceleasi chei. Invalidarea se face prin **TTL** (staleness marginit) sau explicit prin `deleteKey`. Fara `REDIS_URL` sau la eroare, se cade pe recalculare din sursa — un cache „rece" nu afecteaza corectitudinea, doar performanta.
- **Cache-ul in-memory ramane per-proces.** `invalidateGuildCache` curata doar cache-ul din procesul curent; consistenta intre procese vine din Mongo (TTL scurt pe cache-ul de guild), nu din Redis. Redis e pentru date reconstruibile partajate, nu pentru invalidarea cross-proces a cache-ului in-memory.
- **Conventie de chei:** `<domeniu>:<subdomeniu>:<id>` (ex. `player-count:steam:<appId>`), ca sa fie clar cine detine cheia si sa nu se ciocneasca domeniile.

Pe scurt: **Mongo detine adevarul si coordonarea; Redis detine doar cache efemer, reconstruibil, partajat.** Cand adaugi un consumator nou de Redis, incadreaza-l explicit intr-una dintre categoriile de mai sus.

## Ce nu face inca

Conexiunea, utilitarele de cache si metricile de baza exista; separarea `web`/`worker` (prin `BOT_ROLE`) exista si ea. Nu sunt (inca) incluse: **BullMQ** (coada de joburi), dashboard dedicat, sharding, lock-uri prin Redis sau microservicii. Aceste extensii sunt pasi ulteriori si vor fi documentate cand apar (vezi si `docs/architecture/scaling-readiness.md`).

## Invalidarea cache-ului guild intre procese (pub/sub)

Cand Redis e activ, invalidarea cache-ului de setari guild se propaga intre procese prin canalul `guild-settings-changed` (`infra/redis/guildSettingsInvalidationChannel.ts`): fiecare invalidare locala publica guildId-ul, iar fiecare proces abonat (conexiune duplicata, pornita la boot dupa `redis.connect()`) invalideaza local la mesajele primite, fara republish (fara bucla; ecoul propriului mesaj e idempotent). Fara `REDIS_URL`, invalidarea intre procese ramane pe TTL (`GUILD_CACHE_TTL_MS`) — fallback-ul e logat explicit la boot.
