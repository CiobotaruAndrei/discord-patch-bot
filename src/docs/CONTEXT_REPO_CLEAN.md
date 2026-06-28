# Context repo curat

Documentul descrie starea curenta a repo-ului dupa migrarea treptata din fisiere mari legacy spre module organizate pe functionalitate.

## Starea curenta

- Codul principal este in `src/`.
- `src/package.json`, `src/package-lock.json`, `src/.env.example` si `src/tsconfig.json` sunt fisierele active pentru build/test/runtime Node.
- Fisierele active sunt grupate pe functionalitati, nu duplicate la radacina.
- `src/features/command-router/` nu mai reprezinta arhitectura curenta.
- Comenzile cunoscute si autocomplete-ul sunt mutate in `src/features/command-handlers/`.
- `fallbackInteractionHandler.ts` este doar fallback de final pentru interactiuni necunoscute sau ramase neacoperite.
- `notifications/index.ts` este wiring pentru job-uri; logica de update-uri si reduceri este in servicii dedicate. Wiring-ul central e impartit in 3 sub-factory-uri pe responsabilitate — `createOutboxServices` (outbox + history + dead-letter replay + `resolveOutboundChannel` + delivery + drain), `createSeenServices` (`seenRepository`) si `createNotificationDispatchServices` (update + discount services) — iar `createNotificationRuntime` doar le compune in ordinea dependentelor (outbox + seen -> dispatch).
- Rust/N-API este folosit doar pentru hot-path-uri pure, cu fallback TypeScript in `src/native/fuzzy.ts`.
- Registrele de compunere (`commandRegistry`, `sourceRegistry`) folosesc importuri statice pentru module si contracte inchise la iesire (`CommandRegistryContext` fara index signature, `SourceRegistryApi` value-tipat); compozitia nu mai foloseste `as never`, `as unknown as` sau `LegacyInstallerTarget`. `commandRegistry` nu mai are mecanism de installers dinamici: compune explicit si **imutabil** prin factory-uri reale tipate (`createCommandCache`, `createCommandPresentation`, `createNotificationRuntime`, `createFeedbackRepository`, `createSlashCommandDefinitions`) intr-un `createAppServices` (fiecare zona prin **spread in obiecte noi**, fara `Object.assign(base, ...)` pe un singur obiect mutat; registrul public returnat e **`Object.freeze`-uit**), plus o **lista tipata `CommandHandler[]`** (din `attachX.buildCommandHandler(ctx)`) rutata de `dispatchCommand` (loop `canHandle`/`handle`), cu pre-check-ul admin (`requireGuildAdmin`) peste `commandSnoozeGuard` ca strat de protectie inainte de dispatcher, si cere fail-fast prin `requireInstalled` functiile adaugate de handler-e (`handleInteraction`/`buildHelpEmbed`), intorcand contractul inchis `RequiredCommandRegistry` verificat de `tsc`; `sourceRegistry` (`createSourceRegistry(): SourceRegistryApi`, fara parametri) nu mai are `SourceInstaller[]`/`defaultInstallers`/bucla dinamica — compune prin **valorile returnate** de `attach*.buildFrom(...)` prin **spread in obiecte noi** (`{ ...prev, ...attachX.buildFrom(prev) }`, fara `Object.assign(context, ...)` in-place; registru `Object.freeze`-uit), fiecare modul expune un `buildFrom` care intoarce contributia, ordonat (`http -> steam -> updates -> deals`), si citeste exporturile prin `requireSourceValue` pe fiecare cheie. Boot-ul (`main.ts`) si `commandRuntimeContext` folosesc require-uri tipate cu `typeof import(...)`, deci `satisfies AppRuntimeDeps` si return type-ul `CommandRuntimeContext` verifica wiring-ul real; `createSourceRegistry` aplica `assertNoUndefinedExports` pe registry-ul construit din contextul proaspat per apel. La fel, `mongoContext` nu mai e un **installer dinamic pe context mutabil**: `createMongoContext` a renuntat la `MongoInstaller[]` / `defaultInstallers` / bucla `for (install of installers)` si la mutarea singletonului `runtime`; porneste de la o **copie proaspata** (`{ ...baseContext }`) si aplica installer-ele prin **apeluri explicite ordonate** (`attachLogging -> ... -> attachFetchSnapshots`, in ordinea dependentelor), iar exportul singleton e `Object.freeze`-uit. Diferenta fata de registre: modulele Mongo/shared isi pastreaza adaptorul `attachX(target)` (mutatie pe input) fiindca e folosit si direct de scripturi/teste de integrare (`check-db-indexes`, `acquireDbLock`, `guildSettingsCache`); installer-ul ramane deci, dar nu mai e *dinamic* (lista) si nu mai atinge *singletonul* partajat.
- TypeScript strict e activ **global** prin `strict: true` in `src/tsconfig.json` (migrarea incrementala s-a incheiat; fostul `tsconfig.strict.json` — un subset cu aceleasi flag-uri — a fost eliminat ca redundant, dubla doar timpul de typecheck).
- `legacy-dynamic.d.ts` nu mai exista; tipurile dinamice trebuie modelate local.
- Documentatia istorica versionata a fost scoasa din cod; fisierele curente de documentatie raman sursa de adevar.
- Comentariile explicative din fisierele de cod au fost eliminate complet (zero exceptii). Daca un rationale trebuie pastrat, el sta in documentatie dupa subiect, nu langa implementare. Regula este aplicata automat de `scripts/check-no-comments.ts` (parte din `npm run check`, deci si in CI): scaneaza `.ts`/`.js`/`.rs` (parser TypeScript pentru TS/JS ca sa nu existe fals pozitive pe regex/URL; scanner cu ignorare de string-uri pentru Rust) si esueaza la orice comentariu; allowlist-ul de exceptii este gol.
  - **Scope: doar cod sursa runtime/test** (`.ts`/`.js`/`.rs`). Fisierele care nu sunt cod — workflow-uri GitHub Actions (`.yml`), `Dockerfile`, `Markdown`, `JSON` de config — NU intra sub regula si pot purta comentarii explicative (ex. comentariile care documenteaza gate-urile din `release.yml`/`ci.yml`). `checkedExtensions` din scanner enumera exact extensiile acoperite (`.ts`/`.js`/`.rs`), deci restul fisierelor nici nu sunt citite.
- Codul sursa nu foloseste constructii care slabesc tiparea (regula 2), aplicata automat de `scripts/check-no-weakening-types.ts` (parte din `npm run check`, deci si in CI): scaneaza `.ts`/`.js`, inclusiv `src/test`, pe **AST** si esueaza la `any`, `as never` sau dubla asertiune `as unknown as`. NU sunt interzise `unknown` (tipul top, type-safe) si casturile de **narrowing** care ingusteaza din `unknown`/date dinamice externe (Mongo lean, Discord.js, JSON de la API-uri) la un tip utilizabil (`value as Record<string, unknown>`, `item as DealInfo`, `require(...) as typeof import(...)`) — acelea intaresc tiparea. Exceptia regulii 2 pentru teste este reprezentata de un allowlist explicit de fisiere bug-catching, in prezent doar `src/test/checkNoWeakeningTypes.test.ts`; restul testelor sunt scanate normal. Root-ul de scanare e calculat explicit din locatia scriptului (`path.resolve(__dirname, "..", "..")` = `src/`), nu din `process.cwd()`, iar matching-ul de allowlist/ignore accepta atat `test/...` cat si `src/test/...`, deci gate-ul da acelasi rezultat indiferent din ce director e rulat.
- Doua puncte de concurenta subtile din `cron.ts` (rationale-ul lor, mutat din cod aici): (1) heartbeat-ul de reinnoire a lock-ului se re-armeaza (`setTimeout(tick)`) **doar** cat timp `currentCronToken === lockToken` — altfel un tick aflat in zbor ar reinnoi un lock deja eliberat, care intre timp poate fi al altei instante. (2) La finalul ciclului, `currentCronToken` este invalidat (`= null`) **inainte** de `stopHeartbeat()` / `releaseDbLock("cron_main")` — astfel un tick de heartbeat aflat in zbor vede `currentCronToken !== lockToken` si nu se re-armeaza dupa eliberarea lock-ului. Ordinea acestor operatii previne reinnoirea unui lock instrainat; orice refactor in `cron.ts` trebuie sa o pastreze.
- CI (`ci.yml`) valideaza si MongoDB real (serviciu `mongo:7`, folosit de testul de integrare `outboxMongoIndex.integration.test.ts` care verifica indexul unic sparse pe `notificationOutbox.dedupeKey`) si Rust (`cargo clippy --workspace --all-targets -- -D warnings` + `cargo test -p discord_patch_bot_logic` pe crate-ul pur, pe langa compilarea prin `napi build`).
- Codul runtime nu mai foloseste abrevierea legacy pentru context; modulele de compatibilitate folosesc `target` pentru atasare si `deps` pentru factory-uri. Migrarea factory-urilor este incheiata: logica modulelor este expusa prin `createX(deps: XDeps): XApi` cu dependinte explicite, iar `attachX(target)` ramane adaptor subtire (`Object.assign(target, createX(...))`). Tiparul este aplicat la `sources/steam`, `sources/deals`, `sources/updates`, `features/notifications/index`, `command-cache`, `command-presentation` si `infra/http/client.ts`; contractele de boot din `appRuntime` folosesc tipuri explicite (`CommandRuntime`, `ScraperRuntime`, `ActiveLocks`), iar factory-urile centrale din boot wiring (`createCronController`, `createOutboxWorker`, `createHttpServer`, `createHousekeeping`, `registerDiscordEvents`/`registerMongoEvents`, `createShutdownController`) primesc tipurile reale de deps exportate de modulele lor, cu `env` complet `RuntimeEnv` (gard compile-time in `appRuntimeTypedDeps.test.ts`). `SourceRegistryApi` si `MongoRuntimeContext` sunt value-tipate, iar `sources/sourceApis.ts` expune tipurile reale ale API-urilor de surse. Coalescing-ul inflight (`inflightAllGames`, `inflightDeals`, `activeEnrichments`) traieste in closure-ul fiecarei instante de factory, deci instantele cu deps diferite nu impart promisiuni. La nivel de modul raman doar cache-uri pure si deterministe (`enrichedCache`, cache-ul de regex). Singurele `[key: string]: unknown` ramase sunt intentionate: tipuri de date dinamice, schema Mongo si adaptoarele `& Record<string, unknown>` ale modulelor de surse (input de compatibilitate al `attachX`-urilor pe care `sourceRegistry` le compune acum explicit, prin apeluri `attach*` ordonate). Ambele registre (`commandRegistry`, `sourceRegistry`) intorc contracte inchise compuse explicit (`RequiredCommandRegistry`, `SourceRegistryApi`), nu bag-uri de wiring.
- Testele din `src/test` nu mai folosesc abrevieri legacy de context sau tipuri wildcard nesigure; mock-urile Discord/Mongo/HTTP folosesc shape-uri locale si `unknown` pentru cazuri intentionat invalide.
- Helper-ele de test si variabilele de wiring trebuie numite explicit, de exemplu `makeContext`, `runtimeContext` si `validationContext`.

## Structura logica

```text
src/
  app/
    main.ts
    appRuntime.ts
    health/
    lifecycle/
    scheduler/
  config/
    configLoader.ts
    configValidator.ts
  domain/
    deals/
      filtersCore.ts
  features/
    command-cache/
    command-definitions/
    command-handlers/
      autocompleteInteractionHandler.ts
      configInteractionHandler.ts
      dlcInteractionHandler.ts
      fallbackInteractionHandler.ts
      gameFilterHandlers.ts
      helpInteractionHandler.ts
      latestInteractionHandler.ts
      outboxAdminHandler.ts
      reportInteractionHandler.ts
      rolePingHandlers.ts
      setInteractionHandler.ts
      simpleCommandsHandler.ts
      snoozeInteractionHandler.ts
      sourcesStatusHandler.ts
      statusInteractionHandler.ts
      subscriptionNotificationHandlers.ts
      youtubeInteractionHandler.ts
    command-presentation/
    command-registry/
    command-runtime/
    command-snooze/
    command-security/
    notifications/
      deadLetter.ts
      discountNotificationService.ts
      index.ts
      notificationOutbox.ts
      outboundChannel.ts
      seenRepository.ts
      updateNotificationService.ts
    youtube/
      youtubeDeliveryPolicy.ts
      youtubeNotificationService.ts
      youtubeRepository.ts
      youtubeSource.ts
  infra/
    http/
    mongo/
  native/
    fuzzy.ts
    src/lib.rs
    core/src/lib.rs
  shared/
  sources/
    deals/
      index.ts
      dealHelpers.ts
      steamDeals.ts
      epicDeals.ts
      dealEnrichment.ts
    steam/
    updates/
      index.ts
      updateHelpers.ts
      steamUpdates.ts
      listingUpdates.ts
      driverUpdates.ts
      platformUpdates.ts
    sourceRegistry.ts
  test/
```

## Comenzi si interactiuni

Routing-ul interactiunilor e compus de `commandRegistry` ca o **lista tipata `CommandHandler[]`**: fiecare handler expune `buildCommandHandler(ctx): CommandHandler` (`{ canHandle, handle }`), iar `dispatchCommand` itereaza lista si deleaga la primul `canHandle` adevarat (fallback-ul, mereu `canHandle: () => true`, e ultimul). Comenzile admin (`start`/`stop`/`set`/`watchlist`/`snooze`/`unsnooze`/`outbox`/`health`/`config`/`reset-config`/`admin-alerts`/`price-alert`/`sources`/`youtube`) trec intai printr-un pre-check `requireGuildAdmin`, apoi `commandSnoozeGuard` blocheaza comenzile puse temporar pe pauza inainte de `dispatchCommand`. `handleInteraction`-ul exportat de registru (= pre-check admin + snooze guard + `dispatchCommand`) e punctul de intrare folosit de `app/lifecycle/events.ts`. Nu mai exista un lant de `attachX` care impacheteaza `handleInteraction` si nici un fisier `interactions.ts` separat. Logica concreta sta in handler-e dedicate:

- `simpleCommandsHandler.ts` - comenzi simple precum ping/games;
- `helpInteractionHandler.ts` - paginare si continut pentru help;
- `subscriptionNotificationHandlers.ts` - start/stop pentru update-uri si reduceri;
- `gameFilterHandlers.ts` - filtre si validari pentru jocuri, inclusiv `/set games` si `/watchlist`;
- `rolePingHandlers.ts` - roluri pentru ping-uri;
- `setInteractionHandler.ts` - subcomenzile `/set`; la `/set outbox-recovery-verify on` verifica preventiv permisiunea Read Message History pe canalele de notificari (via `checkReadMessageHistory` din runtime) si avertizeaza daca lipseste;
- `configInteractionHandler.ts` - `/config`, sumarul setarilor curente ale serverului intr-un embed ephemeral pentru admini;
- `guildConfigurationAdminHandler.ts` - `/reset-config` si `/admin-alerts`, cu confirmare explicita la reset si verificarea permisiunilor canalului administrativ;
- `priceAlertInteractionHandler.ts` - `/price-alert add/remove/list`, persistenta regulilor joc+prag+valuta si autocomplete pentru joc;
- `snoozeInteractionHandler.ts` - `/snooze` si `/unsnooze`, cu comanda tinta validata prin catalogul `/help command`;
- `outboxAdminHandler.ts` - comenzile admin `/outbox` (`status`, `deadletters`, `clear-deadletters`, `replay-deadletters`, `retry`, `drain-now`, `pause`, `resume`, `permissions`, `recovery-verify status`) pentru operarea outbox-ului (coada per-guild si globala, dead-letter, reprogramare livrari, pauza/reluare drenare, audit de permisiuni pe canale, stare recovery-verify); protejat de admin guard (`outbox` e in lista de comenzi admin). `pause`/`resume` comuta flagul persistent `outboxPaused` (pe `system_state`, via `getOutboxPaused`/`setOutboxPaused`), pe care worker-ul de drenare il verifica la fiecare tick inainte de a lua lock-ul; `permissions` foloseste `checkChannelPermissions` din runtime (Send Messages / Embed Links / Read Message History) pentru un audit la cerere; `drain-now` verifica acelasi flag de pauza inainte de lock, revendica lock-ul `outbox_drain` (acelasi ca worker-ul) si dreneaza imediat doar daca drenarea nu e pe pauza si lock-ul e liber, altfel raporteaza starea fara drenari concurente;
- `latestInteractionHandler.ts` - `/latest`;
- `dlcInteractionHandler.ts` - `/dlc`;
- `statusInteractionHandler.ts` - `/status`;
- `sourcesStatusHandler.ts` - `/sources status`, sumarul ultimelor snapshot-uri persistate pentru sursele externe;
- `youtubeInteractionHandler.ts` - toate comenzile `/youtube`: abonare/dezabonare, canal principal, rute speciale, sablon, filtre, afisare manuala, status, permisiuni si erori;
- `reportInteractionHandler.ts` - `/report submit`, `/report list` si `/report resolve`; `submit` este public, iar `list`/`resolve` au verificare runtime de administrator;
- `autocompleteInteractionHandler.ts` - autocomplete pentru optiuni;
- `fallbackInteractionHandler.ts` - fallback de final.

Fiecare handler primeste dependinte explicite si tipate (factory `createX(deps)`) si expune `buildCommandHandler(ctx): CommandHandler`; `commandRegistry` le aseaza intr-o **lista tipata `CommandHandler[]`** rutata de `dispatchCommand` — primul handler cu `canHandle` adevarat trateaza comanda, fallback-ul (mereu `canHandle: () => true`) e ultimul.

## Notificari

Zona de notificari este impartita astfel:

- `index.ts` instaleaza job-urile si conecteaza serviciile la runtime;
- `updateNotificationService.ts` construieste si trimite notificarile pentru update-uri;
- `discountNotificationService.ts` construieste si trimite notificarile pentru reduceri;
- `priceAlertService.ts` evalueaza regulile de pret peste aceleasi seturi de oferte grupate pe valuta, revendica atomic trecerea sub prag, trimite embed-ul pe canalul de reduceri si rearmeaza regula dupa revenirea pretului peste prag;
- `features/youtube/youtubeSource.ts` rezolva link/handle/channel ID, citeste feed-ul Atom oficial si extrage metadatele necesare filtrelor Shorts/live/premiere/durata;
- `features/youtube/youtubeRepository.ts` gestioneaza baseline-ul mai vechi de o luna, claim/rollback atomic in `guildSeenYoutube`, starea ultimei verificari, rutele invalide si lista plafonata de erori;
- `features/youtube/youtubeDeliveryPolicy.ts` centralizeaza fereastra recenta, sablonul, filtrul de titlu, rutele si loturile de livrare;
- `features/youtube/youtubeNotificationService.ts` grupeaza abonamentele dupa channel ID, face un singur fetch per canal pe ciclu si livreaza automat sau manual prin aceleasi filtre si rute;
- `outboundChannel.ts` rezolva canalul Discord de trimitere;
- `seenRepository.ts` gestioneaza deduplicarea (claim/rollback/seed) pentru update-uri si reduceri. YouTube foloseste acelasi model operational prin `youtubeRepository.ts`. Starea `seen` traieste exclusiv in colectii dedicate: `guildSeenDiscounts` (index unic `{ guildId, dealHash }`), `guildSeenUpdates` (index unic `{ guildId, gameKey, updateId }`) si `guildSeenYoutube` (index unic `{ guildId, channelId, videoId }`). Campurile vechi `seen` / `seenDiscounts` de pe documentul guild au fost eliminate complet din schema. Claim-ul nu scrie pe documentul guild-ului: guard-ul de abonament este un read, iar singura scriere de dedup este create/upsert-ul atomic in colectia dedicata. La `/start` se seed-uieste baseline-ul complet; la `/youtube subscribe` se seed-uieste numai continutul mai vechi de o luna, iar continutul recent ramane eligibil pana la prima activare. Cron-ul de reduceri pre-filtreaza prin `loadSeenDiscountHashes`, iar pentru update-uri si YouTube claim-ul atomic este verificarea autoritara „deja vazut". Afisarea manuala YouTube revendica implicit (claim) videoclipurile cu destinatie pe care le afiseaza, ca o a doua rulare sa nu le reposteze (cu rollback la esec de livrare); optiunea `repeta:true` forteaza repostarea ignorand claim-ul. Cozile `pending` (`pendingUpdates` / `pendingDiscounts`) raman pe documentul guild-ului si sunt reconstruite integral in `$set`-ul final al serviciului dupa fiecare ciclu. Hash-urile de dedup (`dealHash`, `stableUpdateId`) folosesc SHA-256, versionat prin `HASH_VERSION` din `native/fuzzy.ts`; YouTube foloseste identitatea stabila nativa a videoclipului (`videoId`);
- `deadLetter.ts` defineste forma intrarii dead-letter si plafonul cozii;
- `notificationOutbox.ts` este un outbox optional (`NOTIFICATION_OUTBOX_ENABLED`, implicit oprit). Cand e activ, `outboundChannel.ts` intoarce un canal al carui `send` pune mesajul ca job in colectia `notificationOutbox` (dupa claim-ul `seen`, deci fara duplicate), iar logica `drainOutbox` il trimite cu rate limit, reincearca cu backoff la erori tranzitorii si il trece in dead-letter la epuizare/erori permanente. Decupleaza sendul de detectie si supravietuieste caderii Discord (joburile sunt persistente). Drenarea este facuta de un worker dedicat (`app/scheduler/outboxWorker.ts`, `createOutboxWorker`) care ruleaza pe propriul interval (`NOTIFICATION_OUTBOX_DRAIN_INTERVAL_MS`, implicit 15s), nu legat de cadenta cron-ului, sub un lock Mongo dedicat (`outbox_drain`) pentru a evita trimiterile duble intre instante; porneste in handler-ul `ready` (doar cand outbox-ul e activ) si se opreste la shutdown. TTL-ul lock-ului se auto-dimensioneaza din `NOTIFICATION_OUTBOX_DRAIN_LIMIT` (configurabil) si bugetul de trimitere Discord, ca un drain mare sa nu expire lock-ul (override prin `NOTIFICATION_OUTBOX_LOCK_TTL_MS`). Drenarea revendica fiecare job printr-un lease atomic (`findOneAndUpdate` care seteaza `lockedUntil` / `lockedBy`) inainte de livrare, deci doua drenari suprapuse nu pot trimite acelasi job de doua ori, independent de TTL-ul lock-ului. In plus, fiecare job are un `dedupeKey` stabil (SHA-256 peste un payload normalizat cu chei sortate) si exista un istoric scurt de livrari (`notificationOutboxSent`, unic pe `dedupeKey`, TTL configurabil prin `NOTIFICATION_OUTBOX_SENT_TTL_HOURS`, implicit 24h): `enqueueOutbox` sare daca acel `dedupeKey` a fost deja livrat recent (idempotent), iar la drenare un job cu `dedupeKey` deja in istoric este sters fara re-trimitere (recovery dupa crash intre send si delete). In plus, colectia `notificationOutbox` are un index unic *sparse* pe `dedupeKey`, iar `enqueueOutbox` prinde eroarea `E11000` si nu creeaza un al doilea job pending cu acelasi continut (dedupe la nivel de coada, nu doar pe livrarile deja facute); alte erori se propaga. Drenarea prinde fiecare livrare individual (`try/catch` in jurul lui `deliver`): o exceptie la un job e tratata ca esec tranzitoriu (retry/dead-letter) fara sa opreasca restul ciclului; timpul e proaspat per job (backoff/vechime corecte la drenari lungi); backoff-ul de reincercare are jitter + plafon (`min(backoffMs*attempts, 30min)` x `0.5..1.5`). Lease-ul de claim (`lockedUntil`) deriva din `now`-ul injectat in `drainOutbox` (`now.getTime() + leaseMs`), nu din `Date.now()`, ca sa fie consistent cu ceasul de test/abort. Stergerea job-urilor dupa procesare trece prin helper-ul intern `deleteJob`, care prinde erorile de `deleteOne` si le numara in `deleteFailures` in loc sa abandoneze tot ciclul: un Mongo cazut la stergere nu mai face `drainOutbox` sa arunce (worker-ul tot inregistreaza rezultatul partial al ciclului), job-ul ramane in coada si e dedus/reluat la urmatorul ciclu, iar worker-ul ridica admin alert-ul `outbox:delete`. Si sweep-ul TTL (stergerea job-urilor prea vechi, care foloseste un filtru suplimentar `leaseFree`) numara la fel esecurile de stergere in `deleteFailures` printr-un `try/catch` dedicat, deci o cadere Mongo in sweep nu mai e inghitita silentios (`deletedCount: 0`), ci alimenteaza acelasi contor/alerta. Sweep-ul scrie audit-ul dead-letter (`expired-near-ttl`) **inainte** de `deleteOne` (la fel ca bucla principala), nu dupa: daca stergerea esueaza dupa o scriere reusita de audit, jobul ramane in coada si e reluat, dar payload-ul de audit/replay nu se mai pierde (`expired++` ramane gated pe `deletedCount > 0`). In plus, **stergerea unui job ne-livrat se face doar daca scrierea auditului a reusit, pe toate caile terminale**: cele doua cai de expirare (bucla principala + sweep) **si** esecul terminal de livrare (`permanent` / `max-attempts`) trec prin helper-ul `recordDeadLetterOrKeep(job, reason)`, iar daca `recordDeadLetter` arunca, jobul **NU** mai e sters (ramane in coada, reluat la urmatorul ciclu; la `permanent`/`max-attempts` ramane terminal, deci re-revendicarea doar reincearca auditul, nu produce livrari noi), esecul e numarat in `deadLetterFailures`, iar worker-ul ridica admin alert-ul `outbox:deadletter-write` — asa un esec de scriere a auditului nu mai poate duce la pierderea jobului fara payload de replay. Singura cale ramasa intentionat pe stergere neconditionata e `delivered-marksent-failed`: mesajul a fost deja trimis, deci pastrarea jobului ar produce un duplicat. Pe aceasta cale, esecul scrierii auditului **nu mai e silentios**: trece prin helper-ul `recordDeadLetterBeforeDelete`, care incrementeaza `deadLetterFailures` (ridicand `outbox:deadletter-write`) si logheaza un WARN dedicat, dar **tot sterge** jobul — asa operatorul afla de cazul riscant de dedupe-degradat (coreleaza cu `bot_outbox_mark_sent_failures`), fara sa rastorne garantia anti-duplicat. Marcarea „trimis" ruleaza prin `withMongoRetry` si intoarce un boolean; daca tot esueaza dupa o livrare reusita, jobul deja livrat este sters, se scrie audit dead-letter cu motivul `delivered-marksent-failed`, se incrementeaza `bot_outbox_mark_sent_failures`, iar drain-ul curent se opreste dupa acel job ca sa nu continue trimiteri noi cat timp istoricul de dedupe este degradat. Optional (`NOTIFICATION_OUTBOX_RECOVERY_VERIFY=true`, implicit oprit, configurabil si per-guild prin comanda admin `/set outbox-recovery-verify <on|off>`, care scrie `GuildSettings.outboxRecoveryVerify`), embed-urile primesc un marker `dedupeKey` in footer, iar un job re-revendicat (`deliveries > 1`) verifica ultimele mesaje din canal pentru acel marker inainte de a re-trimite — folosind Discord ca sursa de adevar pentru fereastra `send` -> `markSent`. Optional, `NOTIFICATION_OUTBOX_RECOVERY_STRICT=true` (implicit oprit) schimba comportamentul cand fetch-ul de istoric esueaza: in loc de fail-open (trimite oricum), face fail-closed — nu trimite, reprogrameaza jobul cu backoff si numara `recoveryFailures` (care declanseaza admin alert-ul), pentru servere unde duplicatele sunt foarte grave. Logica de livrare (inclusiv verificarea pe istoric) sta in `outboxDelivery.ts` (`createOutboxDelivery`), testabila izolat, iar rezultatele alimenteaza metrici la `/metrics` (`bot_outbox_recovery_duplicates_prevented` / `bot_outbox_recovery_history_fetches` / `bot_outbox_recovery_verify_failures` / `bot_outbox_recovery_marker_missing`). Campul `recoveryVerify` este declarat in schema outbox (altfel strict mode l-ar sterge), iar numarul de mesaje scanate la verificare este configurabil prin `NOTIFICATION_OUTBOX_RECOVERY_HISTORY_LIMIT` (implicit 25). Discord nu permite exact-once real, dar lease-ul + istoricul reduc fereastra de duplicare la intervalul dintre trimiterea pe Discord si scrierea in istoric. Worker-ul alimenteaza metrici Prometheus la `/metrics` din rezultatul fiecarui drain: `bot_outbox_sent` / `bot_outbox_retried` / `bot_outbox_dead_lettered` / `bot_outbox_drains` / `bot_outbox_lock_acquire_failures` (countere), `bot_outbox_delivery_ms_total` (latenta cumulata) si `bot_outbox_queue_depth` / `bot_outbox_oldest_job_age_seconds` (gauge-uri pentru backlog), plus `bot_outbox_mark_sent_failures` (livrari care nu au putut fi inregistrate in istoricul de dedupe). Cand un drain raporteaza esecuri, worker-ul trimite si un admin alert cu cooldown per-tip: `outbox:recovery-read` cand `recoveryFailures > 0` (lipseste permisiunea Read Message History), `outbox:mark-sent` cand `markSentFailures > 0` (risc de duplicare la recovery), `outbox:delete` cand `deleteFailures > 0` (job-uri procesate care nu s-au putut sterge din coada) si `outbox:deadletter-write` cand `deadLetterFailures > 0` (auditul dead-letter la expirare a esuat, deci job-urile nu au fost sterse), ca operatorul sa afle proactiv, nu doar din metrici. In plus, gauge-ul `bot_outbox_recovery_verify_enabled_guilds` (refresh-uit la fiecare drain din `countDocuments`) arata cate servere au activat protectia maxima per-guild.
- La drain, verificarea abonarii pe guild/canal este fail-closed la eroare Mongo: daca `isStillSubscribed` nu poate confirma abonarea, jobul se reprogrameaza cu backoff si nu se livreaza, ca sa nu trimita intr-un canal dezabonat sau reconfigurat.

Aceasta impartire reduce riscul de copy-paste in cron jobs si permite teste functionale mai clare.

Trimiterea catre Discord se face grupat: serviciile claim-uiesc itemii (`seen`) intr-o faza, apoi trimit pana la 10 embed-uri per mesaj (limita Discord), in pachete de pana la `MAX_UPDATES_PER_CYCLE` / `MAX_DEALS_PER_CYCLE`; YouTube foloseste maximum 5 videoclipuri per mesaj si asteapta 10 minute intre loturile suplimentare. Asta scade numarul de request-uri Discord si presiunea pe rate limit. Daca un mesaj esueaza, pachetul lui se face rollback si re-coadeaza (sau dead-letter la epuizare), iar ping-ul de rol apare doar pe primul mesaj.

Cand o livrare (update sau reducere) epuizeaza toate reincercarile (`PENDING_UPDATE_MAX_ATTEMPTS` / `PENDING_DISCOUNT_MAX_ATTEMPTS`), item-ul nu mai este aruncat silentios: este persistat in campul `notificationDeadLetter` de pe documentul guild-ului, impreuna cu motivul, numarul de incercari si momentul esecului. Coada este plafonata la ultimele `NOTIFICATION_DEAD_LETTER_LIMIT` intrari prin `$slice`, astfel incat documentul nu creste nelimitat. Scopul este vizibilitate asupra livrarilor esuate definitiv si pastrarea informatiei la restart.

Faza de fetch are un event store: dupa fiecare ciclu cron reusit, rezultatele normalizate se persista in DB prin `infra/mongo/fetchSnapshots.ts` (`saveFetchSnapshot`) — cheia `updates` pentru lista completa de update-uri si `deals:<MONEDA>` pentru reduceri. Scrierile sunt best-effort (nu blocheaza cron-ul) si documentele au TTL. La pornire, `app/main.ts` hidrateaza cache-urile in-memory din aceste snapshot-uri (`loadFetchSnapshot` / `loadDealsFetchSnapshots`, expuse setter-ele `setUpdatesCache` / `setDealsCache` prin `commandRegistry`) cand sunt suficient de proaspete, deci comenzile servesc imediat ultimele date dupa restart. Acest store este si baza peste care un dispatcher separat va putea citi evenimentele, decupland fetch-ul de trimitere.

Ca prim pas de decuplare, faza de dispatch foloseste deja event store-ul ca rezerva: daca fetch-ul live esueaza in ciclul cron (`getLatestForAllGames` pentru update-uri sau `fetchDeals` pentru reduceri), dispatch-ul citeste ultimul snapshot persistat (`loadFetchSnapshot`) si continua trimiterile de pe ultimele date bune in loc sa abandoneze ciclul. Snapshot-ul de rezerva este folosit doar daca este proaspat: `fetchedAt` trebuie sa fie sub `SNAPSHOT_FALLBACK_MAX_AGE_MS` (60 de minute); altfel snapshot-ul invechit este ignorat (ciclul de update-uri se opreste, guild-ul de reduceri se sare), ca sa nu se trimita date vechi. Deduplicarea `seen` previne re-trimiterea, iar daca nu exista snapshot proaspat comportamentul ramane cel vechi (abandon/skip).

## Native Rust/N-API

`native/` e un workspace Cargo: logica traieste in crate-ul pur `discord_patch_bot_logic` (`src/native/core/src/lib.rs`, rlib fara napi, cu toate testele unitare — `cargo test -p discord_patch_bot_logic` ruleaza fara build-ul N-API), iar `src/native/src/lib.rs` e doar wrapper-ul cdylib `#[napi]` care deleaga la core. Functiile raman deterministe, fara Discord, Mongo sau HTTP:

- fuzzy matching si Levenshtein;
- normalizare text si titluri;
- `stableUpdateId`, `normalizeDealState` si `dealHash`;
- scoring pentru listing-uri si URL-uri Steam;
- `buildAutocompleteChoices` pentru scoring, sortare si limitare optiuni Discord;
- `dealPassesFilters` pentru filtrarea ofertelor in cron si `/latest reduceri`.

`src/native/fuzzy.ts` ramane adapterul TypeScript cu fallback. Daca addon-ul `.node` nu se incarca, botul continua pe fallback si logheaza explicit problema. Fallback-urile trebuie sa pastreze acelasi comportament observabil ca implementarea Rust; de exemplu `extractDateScore` scaneaza tot URL-ul dupa prima data `YYYY-MM-DD` valida (nu se opreste la prima potrivire de tipar daca aceasta are valori in afara intervalului), pentru ca sortarea candidatilor `listing_based` dupa data sa fie identica indiferent de calea folosita.

## TypeScript strict

Strict-ul e activ **global** prin `strict: true` in `src/tsconfig.json` — `npm run typecheck` verifica tot proiectul. Migrarea incrementala (fostul `tsconfig.strict.json`, un subset cu aceleasi flag-uri) s-a incheiat si fisierul a fost eliminat ca redundant.

Zone deja potrivite pentru strict:

- filtre pure din `src/domain/deals/`;
- repository-ul de seen items;
- serviciile de notificari;
- handler-ele de comenzi extrase;
- utilitarele de health/metrics si config;
- adapterul `src/native/fuzzy.ts`;
- sursele `src/sources/steam`, `src/sources/deals` si `src/sources/updates`;
- testele functionale/E2E si testele directe de shape drift pentru scrapers.

Zone care inca trebuie urmarite:

- installerele `attachCommandCache` si `attachCommandUi` nu mai paseaza toata punga `target` catre factory; construiesc un obiect `deps` explicit, restrans, cu doar cheile declarate (TypeScript impune completitudinea), iar `filters`, `notifications/index`, fallback-ul de interactiuni si `mongoContext` au deja factory-uri explicite;
- toate handler-ele de comenzi (`simpleCommands`, `status`, `autocomplete`, `dlc`, `gameFilter`, `rolePing`, `set`, `subscription`, `help` si fallback) plus agregatorul `latest` primesc acum un `deps` explicit, restrans, in loc de toata punga `target`; la `latest`, tipul `deps` este intersectia explicita a celor patru sub-handlere (`latestUpdates`, `latestDeals`, `latestSingle`, `priceSearch`), fara index signature, asa incat TypeScript impune lista completa de dependinte;
- stratul de wiring nu mai vehiculeaza un singleton mutabil netipat: `commandRuntimeContext.ts` expune acum o factory tipata `createCommandRuntimeContext()` (cu interfata explicita `DiscordRuntimeBindings` pentru constructorii discord.js), iar `commandRegistry.ts` construieste un context proaspat la fiecare apel `createCommandRegistry` in loc sa mute un singleton global comun; asta elimina si riscul de dublare a lantului `handleInteraction` la o eventuala re-rulare;
- mock-urile de test trebuie mentinute pe shape-uri locale mici cand apar fluxuri noi pentru Discord, Mongo sau HTTP.

## Securitate si runtime

- Comenzile administrative trebuie sa aiba atat permisiuni declarate in slash command, cat si verificari runtime in handler.
- Linkurile externe si proxy-urile trebuie validate prin config, iar request-urile HTTP trec prin validare URL si DNS/IP ca protectie SSRF.
- Modulul HTTP din `infra/http` este descompus pe responsabilitati: `client.ts` ramane wiring-ul (agenti keep-alive cu lookup DNS sigur, instanta axios, proxy-uri, helperele native/cheerio si buclele `httpReq`/`fetchWithProxy`), iar logica pura sta in module dedicate, testabile independent — `ssrfGuard.ts` (guard SSRF + DNS-rebinding), `retryPolicy.ts` (clasificarea esecurilor + backoff cu jitter/plafon, `random` injectabil), `proxyTemplates.ts` (rezolvarea/validarea template-elor de proxy), `conditionalCache.ts` (`createConditionalGet` cu cache ETag/Last-Modified LRU si `httpReq` injectat) si `httpMetrics.ts` (counter-ele initiale). Orice logica HTTP pura noua ar trebui adaugata in modulul corespunzator, nu inghesuita in `client.ts`.
- Clientul HTTP expune `conditionalGet(url, parse)`: pentru sursele de update-uri cu un singur fetch direct (Steam, Minecraft, Roblox, Nvidia) tine minte `etag` / `last-modified` per URL si trimite `If-None-Match` / `If-Modified-Since`; pe `304 Not Modified` reuseaza rezultatul parsat anterior, fara redescarcare/reparsare. Surse noi cu fetch unic ar trebui sa foloseasca acelasi helper. Sursele prin proxy nu pot face conditional GET fiindca proxy-ul nu pastreaza header-ele de raspuns.
- `getLatestForAllGames` grupeaza jocurile dupa sursa (`sourceConcurrencyGroup`: steam / epic / listing / driver / other) si ruleaza fiecare grup in paralel cu propria concurrency (`FETCH_CONCURRENCY_STEAM` / `_EPIC` / `_LISTING` / `_DRIVER`, restul pe `FETCH_CONCURRENCY`), ca o sursa lenta sa nu blocheze tot ciclul; rezultatele raman aliniate la ordinea de intrare.
- `/metrics` trebuie protejat cu token cand este expus in afara mediului local.
- Token-urile Discord, URI-urile Mongo si webhook-urile nu trebuie comise.
- Docker trebuie sa ruleze procesul ca user non-root.
- Prezentarea reducerilor trebuie sa fie robusta la date corupte: `validatePendingDiscountSnapshot` ingusteaza snapshot-urile persistate la `ValidatedDealInfo` (cu `title`, `store`, `link`, preturi si `savings` obligatorii), iar `buildDealEmbed` limiteaza procentul afisat la intervalul `[0, 100]`, astfel incat un snapshot `pendingDiscounts` reluat sau alterat sa nu poata produce procente imposibile in embed-uri.

## Teste importante

Ruleaza din `src/`:

```bash
npm test
npm run test:functional
npm run test:e2e
npm run typecheck
npm run build
npm run benchmark
```

`npm run benchmark` (`scripts/notificationBenchmark.ts`) ruleaza un ciclu de update-uri si unul de reduceri pentru 100/500/1000 de guild-uri (sau `BENCHMARK_GUILDS`) cu dependinte care numara I/O-ul, si raporteaza durata, trimiterile Discord, write-urile Mongo si fetch-urile per dimensiune; util pentru a vedea cum scaleaza un ciclu cron.

Teste relevante pentru structura actuala:

- `simpleCommandsHandler.functional.test.ts`;
- `latestInteractionHandler.functional.test.ts`;
- `dlcInteractionHandler.functional.test.ts`;
- `statusInteractionHandler.functional.test.ts`;
- `autocompleteInteractionHandler.functional.test.ts`;
- `notificationServices.functional.test.ts`;
- `seenRepository.functional.test.ts`;
- `dealFiltersCore.functional.test.ts`;
- `rustFuzzy.test.ts`;
- `sourceScraperShapeDrift.test.ts`;
- testele E2E pentru update-uri si reduceri.

## Zone ramase de curatat

- Contextul comun din runtime si registry a fost restrans: factory-urile si handler-ele primesc `deps` explicit, iar `commandRuntimeContext` este o factory tipata consumata de `commandRegistry` cu context proaspat per apel. Daca apar module noi de comenzi, ele trebuie sa pastreze acelasi model (factory cu `deps` explicit, fara sa citeasca direct din punga comuna).
- Mentinerea testelor fara tipuri wildcard nesigure sau abrevieri legacy de context cand se adauga mock-uri noi.
- Mutarea oricarei logici ramase in adaptere catre servicii sau handler-e dedicate.
- Mentinerea documentatiei sincronizate la fiecare schimbare de cod.
