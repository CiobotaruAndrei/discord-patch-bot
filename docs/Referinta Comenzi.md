# Referinta Comenzi

> Fisier generat automat din `COMMAND_CATALOG_HELP` (`src/features/command-catalog/commandCatalog.ts`), aceeasi sursa unica pe care o foloseste comanda `/help` in Discord. Nu edita manual acest fisier: ruleaza `npm run docs:commands` din `src/`. Sincronizarea catalog <-> fisier este verificata de `commandReferenceDoc.test.ts` si de `npm run check:docs-commands`.

Total comenzi documentate: 173.

| Comanda | Permisiuni | Ce face | Exemplu |
| --- | --- | --- | --- |
| `/ping` | Public | Verifica rapid daca botul raspunde la Discord. | `/ping` |
| `/games` | Public | Listeaza jocurile cunoscute de bot si cheile/poreclele pe care le poti folosi in comenzile cu joc. | `/games` |
| `/help` | Public | Afiseaza meniul general de ajutor. Daca alegi o comanda in optiunea command, primesti explicatia detaliata pentru comanda aceea. | `/help command:/set add games` |
| `/config` | Admin, Ephemeral | Afiseaza intr-un singur loc setarile curente ale serverului: mode, filtre de reduceri, valuta, store-uri, jocuri active, roluri si canale. | `/config` |
| `/add backup` | Admin runtime, Ephemeral | Salveaza configuratia curenta a botului pentru server intr-un backup numit. Backup-ul include canale, roluri, filtre, watchlist, snooze-uri, alerte de pret si configurarea YouTube. | `/add backup name:inainte-youtube` |
| `/add price-alert` | Admin runtime, Ephemeral | Adauga sau actualizeaza o alerta care se declanseaza cand jocul ajunge la sau sub pragul ales, in valuta aleasa. Nota: Alerta foloseste canalul configurat prin /start reduceri si se rearmeaza dupa ce pretul urca din nou peste prag. | `/add price-alert joc:elden-ring price:30 currency:EUR` |
| `/remove price-alert` | Admin runtime, Ephemeral | Sterge toate alertele de pret configurate pentru jocul ales. | `/remove price-alert joc:elden-ring` |
| `/add suggestion` | Public, Ephemeral | Permite unui user sa propuna o comanda noua, cu numele si descrierea functionalitatii dorite. | `/add suggestion name:calendar description:Sa arate urmatoarele update-uri programate` |
| `/suggest-command` | Public, Ephemeral | Permite unui user sa propuna direct o comanda noua, cu numele si descrierea functionalitatii dorite. | `/suggest-command name:calendar description:Sa arate urmatoarele update-uri programate` |
| `/list suggest-command` | Admin, Ephemeral | Listeaza comenzile propuse de useri pe server, cu numele propus si ce ar trebui sa faca. | `/list suggest-command numar:10` |
| `/add watchlist-game` | Public, Ephemeral | Propune un joc nou pentru lista botului; este aliasul clar al rutei /watchlist-game add. | `/add watchlist-game game:silksong` |
| `/snooze` | Admin, Ephemeral | Pune temporar pe pauza o comanda existenta a botului pentru server. Comanda aleasa vine din autocomplete, iar durata accepta valori precum 30m, 2h sau 1d. Nota: Nu poate opri /snooze sau /unsnooze, ca adminii sa poata gestiona mereu pauzele. | `/snooze command:/latest updates durata:2h` |
| `/unsnooze` | Admin, Ephemeral | Scoate pauza temporara de pe o comanda pusa anterior in snooze. | `/unsnooze command:/latest updates` |
| `/add watchlist` | Admin runtime, Ephemeral | Adauga un joc deja cunoscut de bot in watchlist-ul serverului. | `/add watchlist joc:cs2` |
| `/remove watchlist` | Admin runtime, Ephemeral | Scoate un joc din watchlist-ul serverului. | `/remove watchlist joc:cs2` |
| `/status game` | Public | Afiseaza daca jocul este online, in mentenanta, degradat sau cu stare necunoscuta. | `/status game joc:minecraft` |
| `/status watchlist` | Public | Verifica independent starea serverelor pentru jocurile compatibile din watchlist si pagineaza rezultatele. | `/status watchlist` |
| `/report bug` | Public, Ephemeral | Deschide un formular pentru descrierea obligatorie a unui bug si evita duplicatele pentru acelasi tip, joc si text. | `/report bug tip:sursa-stricata joc:cs2` |
| `/report complaint` | Public, Ephemeral | Deschide un formular pentru reclamarea unui membru; nu permite auto-raportarea sau raportarea botilor. | `/report complaint target:@membru` |
| `/report list bugs` | Admin runtime, Ephemeral | Listeaza exclusiv rapoartele de bug, cu paginare si ID-uri de stergere. | `/report list bugs` |
| `/report list users` | Admin runtime, Ephemeral | Listeaza exclusiv reclamatiile impotriva membrilor, cu paginare. | `/report list users` |
| `/report remove bug` | Admin runtime, Ephemeral | Sterge un ID numai din lista rapoartelor de bug. | `/report remove bug id:64a1f2b3c4d5e6f789012345` |
| `/report remove user` | Admin runtime, Ephemeral | Sterge un ID numai din lista reclamatiilor impotriva membrilor. | `/report remove user id:64a1f2b3c4d5e6f789012345` |
| `/health` | Admin, Ephemeral | Afiseaza starea tehnica a botului: conexiune Discord, MongoDB, uptime si cache. | `/health` |
| `/price-check` | Public | Cauta pretul jocului pe Steam si il compara cu ofertele comparabile din sursele externe de reduceri folosite de bot. Pretul Steam este afisat in embed verde. | `/price-check joc:elden-ring` |
| `/deal-score` | Public | Calculeaza un scor 1-10 pentru oferta activa a unui joc pe baza reducerii, pretului curent, semnalelor de calitate/popularitate si magazinului. | `/deal-score game:elden-ring` |
| `/best deals under` | Public | Cauta cele mai bune reduceri sub bugetul ales in toate sursele de deals active, nu doar in watchlist-ul serverului. | `/best deals under buget:50 currency:EUR numar:5` |
| `/ending deals` | Public | Afiseaza ofertele care au termen de expirare detectat si le sorteaza dupa cat de aproape este expirarea. | `/ending deals currency:EUR numar:5` |
| `/review-trend game` | Public | Afiseaza semnalul curent al review-urilor Steam pentru joc: procent pozitiv, numar de review-uri si interpretare operationala. | `/review-trend game game:elden-ring` |
| `/crossplay game` | Public | Verifica metadatele Steam pentru semnale de crossplay si cross-save. Daca sursa nu confirma, raspunsul spune explicit ca nu este detectat. | `/crossplay game game:elden-ring` |
| `/platforms game` | Public | Afiseaza platformele Steam detectate si magazinele externe gasite in sursele de reduceri pentru jocul cautat. | `/platforms game game:elden-ring` |
| `/co-op game` | Public | Afiseaza modurile detectate in Steam pentru joc: single-player, online co-op, local/split-screen co-op, PvP sau MMO. | `/co-op game game:elden-ring` |
| `/system requirements game` | Public | Afiseaza cerintele minime si recomandate returnate de Steam pentru joc. | `/system requirements game game:elden-ring` |
| `/game-size game` | Public | Extrage dimensiunea aproximativa de instalare din cerintele de sistem Steam, cand informatia este disponibila. | `/game-size game game:elden-ring` |
| `/player-count game` | Public | Afiseaza numarul curent de jucatori activi pe Steam pentru jocul ales, cand jocul are Steam appId configurat. | `/player-count game game:Counter-Strike 2` |
| `/player-count trend` | Public | Afiseaza evolutia player-count, minimul, maximul, media, valoarea recenta si un grafic compact pentru 24h, 7d sau 30d. | `/player-count trend joc:cs2 period:7d` |
| `/player-count milestone` | Public | Afiseaza recordul istoric, data recordului, valoarea curenta si diferenta fata de record. | `/player-count milestone joc:cs2` |
| `/player-count gainers` | Public | Ordoneaza jocurile dupa cea mai mare crestere numerica de player-count in perioada selectata. | `/player-count gainers period:24h` |
| `/player-count peak-time` | Public | Calculeaza zilele si intervalele orare cu cea mai mare medie de jucatori in fusul orar al serverului. | `/player-count peak-time joc:cs2 period:7d` |
| `/game overview` | Public | Combina ultimul update, oferta, deal score, player-count, server status, DLC-uri recente si prezenta in watchlist, fara ca esecul unei surse sa ascunda restul. | `/game overview joc:cs2` |
| `/top active games` | Public | Afiseaza topul global al jocurilor cunoscute de bot care au Steam appId, sortat dupa player-count Steam. Nu este limitat de watchlist-ul sau filtrul de jocuri al serverului. | `/top active games numar:5` |
| `/dlc` | Public | Cauta DLC-uri pentru un joc. | `/dlc joc:Counter-Strike 2` |
| `/set new-account-alert-channel` | Admin, Ephemeral | Alege canalul pentru alertele de conturi noi. | `/set new-account-alert-channel canal:#security` |
| `/start new-account-alerts` | Admin, Ephemeral | Porneste alertele pentru conturi create in ultimele trei luni si verifica imediat membrii existenti. | `/start new-account-alerts` |
| `/stop new-account-alerts` | Admin, Ephemeral | Opreste alertele pentru conturi noi. | `/stop new-account-alerts` |
| `/set threat-alert-channel` | Admin, Ephemeral | Alege canalul pentru alertele de amenintari. | `/set threat-alert-channel canal:#security` |
| `/start threat-protection` | Admin, Ephemeral | Inspecteaza linkurile si atasamentele. Sterge automat DOAR amenintarile confirmate de motorul extern de reputatie; fisierele executabile/script, incalcarile de politica (@everyone, invitatii) si resursele incerte doar alerteaza, fara stergere. | `/start threat-protection` |
| `/stop threat-protection` | Admin, Ephemeral | Opreste protectia la amenintari. | `/stop threat-protection` |
| `/set permission-request-channel` | Admin, Ephemeral | Alege canalul unic pentru toate cererile de aprobare de securitate si deciziile ownerului. | `/set permission-request-channel canal:#aprobari` |
| `/set anti-raid-alert-channel` | Admin, Ephemeral | Seteaza canalul anti-raid in care botul publica alertele, interventiile, participantii si erorile incidentului. | `/set anti-raid-alert-channel canal:#anti-raid` |
| `/set anti-raid-thresholds` | Admin, Ephemeral | Modifica pragurile anti-raid. Optiunile nedate raman la valoarea curenta, iar o valoare in afara limitelor e refuzata cu motiv, fara sa piarda celelalte valori valide. Nota: Implicit: 3 mesaje identice in 8s, minimum 4 mentiuni in 10s, minimum 3 mesaje cu invitatii in 20s, minimum 4 mesaje cu linkuri in 12s, minimum 2 participanti coordonati in 15s, minimum 3 canale sau roluri in 20s. Nota: Implicit: perioada de siguranta 30m, mute 24h, timeout 24h, lockdown maxim 45m. Nota: Duratele se scriu cu s, m, h sau d, de exemplu 8s, 30m, 24h. | `/set anti-raid-thresholds identical-messages:4 safety-period:1h` |
| `/start anti-raid-dry-run` | Admin, Ephemeral | Porneste modul de testare anti-raid: botul arata ce ar detecta si ce ar executa, fara sa blocheze canale, fara sa sanctioneze si fara sa publice anunturi de raid. | `/start anti-raid-dry-run` |
| `/stop anti-raid-dry-run` | Admin, Ephemeral | Opreste modul de testare anti-raid si pastreaza rezultatele in istoricul incidentelor. | `/stop anti-raid-dry-run` |
| `/set ad-alert-channel` | Admin, Ephemeral | Alege canalul pentru cererile de aprobare a reclamelor, reclamele sterse, tentativele detectate si warn-urile automate. | `/set ad-alert-channel canal:#reclame` |
| `/start ad-protection` | Admin, Ephemeral | Porneste protectia impotriva reclamelor neaprobate de owner, inclusiv reclamele fara link: promovarea altor servere, comunitati, servicii, produse, pagini sau conturi. | `/start ad-protection` |
| `/stop ad-protection` | Admin, Ephemeral | Opreste protectia si transforma toate cererile si aprobarile active neexpirate in cancelled. Istoricul tentativelor, warn-urile si canalul configurat raman salvate. | `/stop ad-protection` |
| `/set warn-channel` | Admin, Ephemeral | Alege canalul dedicat in care sunt publicate warn-urile si dovezile directe. | `/set warn-channel canal:#moderation` |
| `/start anti-raid` | Admin, Ephemeral | Porneste protectia anti-raid. Refuza activarea daca botul nu poate sanctiona sau bloca canale. Nota: Necesita View Audit Log, Moderate Members, Mute Members, Manage Channels, Manage Roles si un rol deasupra @everyone. Nota: Fara activare explicita detectorul nu acumuleaza semnale. | `/start anti-raid` |
| `/start moderation-guard` | Admin, Ephemeral | Porneste unitar protectiile administrative bazate pe aprobare din afara raidurilor: bot-add, permission-grant, moderation-mass, webhook, server-structure si protected-resource-change. | `/start moderation-guard` |
| `/stop anti-raid` | Admin, Ephemeral | Opreste modulul anti-raid; owner-only si cu confirmare obligatorie. Nota: Este alta operatiune decat /anti-raid force-stop, care doar incheie un incident in curs. Nota: Dupa oprire serverul ramane fara detectie de raid. | `/stop anti-raid confirm:true` |
| `/stop moderation-guard` | Admin, Ephemeral | Opreste protectiile administrative din afara raidurilor si anuleaza cererile si aprobarile nefolosite pentru cele sase tipuri; istoricul si canalul raman salvate. | `/stop moderation-guard` |
| `/set admin-command-access` | Admin top-level, owner-only runtime, Ephemeral | Seteaza rolul care poate folosi comenzile admin pe langa Administrator si codul global de acces. Fara command seteaza fallback-ul global; cu command seteaza regula doar pentru acea comanda sau acel pachet, de exemplu /start updates. Perechile start/stop pentru acelasi modul folosesc aceeasi regula. Nota: Mode `role` accepta doar rolul ales, iar `role-or-higher` accepta rolul ales sau unul mai mare. Nota: O regula pentru `/start player-count` se aplica automat si la `/stop player-count`. Nota: Pana ownerul seteaza o regula de rol, rolurile nu dau acces admin; raman Administrator si codul global corect introdus prin modal ephemeral. | `/set admin-command-access role:@Moderator mode:role-or-higher command:/start player-count` |
| `/price-alert list` | Admin, Ephemeral | Listeaza alertele de pret, pragurile, valutele si starea armata sau declansata. | `/price-alert list` |
| `/watchlist-game add` | Public, Ephemeral | Permite unui user sa propuna un joc nou pentru lista botului. Propunerea nu activeaza jocul automat. | `/watchlist-game add game:silksong` |
| `/watchlist-game list` | Public, Ephemeral | Afiseaza jocurile propuse de useri pentru a fi adaugate in lista botului. | `/watchlist-game list numar:10` |
| `/watchlist-game delete` | Admin runtime, Ephemeral | Sterge un joc din lista de propuneri watchlist-game. | `/watchlist-game delete game:silksong` |
| `/future-release add` | Admin runtime, Ephemeral | Adauga un joc care urmeaza sa apara in lista future-release a serverului. Lista are maxim 20 de jocuri. | `/future-release add game:silksong release-date:2026 preorder-price:indisponibil` |
| `/future-release list` | Public | Afiseaza public jocurile future-release urmarite, data lansarii si pretul de preorder daca sunt salvate. | `/future-release list` |
| `/future-release delete` | Admin runtime, Ephemeral | Sterge un joc din lista future-release. | `/future-release delete game:silksong` |
| `/future-release start` | Admin runtime, Ephemeral | Configureaza canalul curent pentru notificarile future-release si marcheaza modulul activ pentru server. | `/future-release start` |
| `/future-release stop` | Admin runtime, Ephemeral | Opreste notificarile future-release si sterge canalul salvat pentru acest modul. | `/future-release stop` |
| `/start updates` | Admin, Ephemeral | Porneste notificarile automate de update-uri pe canalul curent si face baseline, ca botul sa nu trimita retroactiv toate update-urile vechi. | `/start updates` |
| `/start reduceri` | Admin, Ephemeral | Porneste alertele automate de reduceri pe canalul curent si face baseline, ca botul sa trimita doar reducerile noi gasite dupa activare. | `/start reduceri` |
| `/start dlc` | Admin, Ephemeral | Configureaza canalul curent pentru notificarile DLC ale jocurilor active. Motorul automat DLC foloseste aceasta configuratie cand este activ in runtime. | `/start dlc` |
| `/start player-count` | Admin, Ephemeral | Adauga un joc cu Steam appId in lista de jocuri urmarite pentru topurile player-count ale serverului si salveaza canalul curent pentru acest modul. | `/start player-count game:cs2` |
| `/stop updates` | Admin, Ephemeral | Opreste notificarile automate de update-uri pentru server. | `/stop updates` |
| `/stop reduceri` | Admin, Ephemeral | Opreste alertele automate de reduceri pentru server. | `/stop reduceri` |
| `/stop dlc` | Admin, Ephemeral | Opreste notificarile DLC si sterge canalul salvat pentru acest modul. | `/stop dlc` |
| `/stop player-count` | Admin, Ephemeral | Scoate un joc din lista de player-count a serverului. Daca nu mai ramane niciun joc, modulul player-count este oprit pentru server. | `/stop player-count game:cs2` |
| `/set mode` | Admin, Ephemeral | Alege formatul embed-urilor de update: compact pentru mesaje scurte sau detailed pentru mai multe detalii. | `/set mode value:detailed` |
| `/set mindiscount` | Admin, Ephemeral | Seteaza procentul minim de reducere acceptat pentru alertele de reduceri. | `/set mindiscount value:50` |
| `/set maxprice` | Admin, Ephemeral | Seteaza pretul maxim acceptat pentru ofertele platite. Valoarea 0 dezactiveaza limita. | `/set maxprice value:100` |
| `/set free` | Admin, Ephemeral | Porneste sau opreste afisarea jocurilor gratuite in alertele de reduceri. | `/set free value:on` |
| `/set paid` | Admin, Ephemeral | Porneste sau opreste afisarea ofertelor platite in alertele de reduceri. | `/set paid value:on` |
| `/set currency` | Admin, Ephemeral | Alege valuta folosita pentru preturi si alerte de reduceri. | `/set currency value:EUR` |
| `/set stores` | Admin, Ephemeral | Filtreaza reducerile dupa magazine, de exemplu Steam si Epic, sau reseteaza filtrul. | `/set stores value:steam,epic` |
| `/set add games` | Admin, Ephemeral | Adauga un joc deja cunoscut de bot in lista explicita de jocuri active pentru server. Nota: Nu adauga un joc nou in codul botului; doar activeaza pentru server un joc existent in configuratie. | `/set add games joc:cs2` |
| `/set remove games` | Admin, Ephemeral | Scoate un joc din lista explicita de jocuri active pentru server. | `/set remove games joc:cs2` |
| `/set games reset` | Admin, Ephemeral | Reseteaza filtrul per-joc. Dupa reset, serverul foloseste toate jocurile cunoscute de bot. | `/set games reset` |
| `/watchlist show` | Admin, Ephemeral | Afiseaza jocurile urmarite explicit pe server. Daca lista este goala, serverul foloseste toate jocurile configurate. | `/watchlist show` |
| `/watchlist reset` | Admin, Ephemeral | Reseteaza watchlist-ul. Dupa reset, toate jocurile configurate sunt active. | `/watchlist reset` |
| `/watchlist coverage` | Admin, Ephemeral | Afiseaza pentru fiecare joc urmarit disponibilitatea update-urilor, reducerilor, server status, player-count, DLC, Steam appId si sursele configurate. | `/watchlist coverage` |
| `/set role updates` | Admin, Ephemeral | Seteaza rolul pingat la notificarile de update-uri. Daca nu alegi rol, ping-ul se opreste. | `/set role updates value:@Updates` |
| `/set role discounts` | Admin, Ephemeral | Seteaza rolul pingat la alertele de reduceri. Daca nu alegi rol, ping-ul se opreste. | `/set role discounts value:@Deals` |
| `/latest updates` | Public | Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache si poate folosi snapshot-ul persistat daca fetch-ul live esueaza. | `/latest updates` |
| `/latest reduceri` | Public | Afiseaza cele mai bune reduceri curente care trec filtrele serverului. | `/latest reduceri` |
| `/latest update` | Public | Cauta ultimul update pentru un joc anume. | `/latest update joc:cs2` |
| `/latest pret` | Public | Cauta pretul curent al unui joc pe Steam. | `/latest pret joc:Counter-Strike 2` |
| `/sources status` | Admin, Ephemeral | Afiseaza starea ultimelor snapshot-uri pentru sursele de date: reduceri Steam/Epic, feed-uri de update si vechimea ultimului fetch. | `/sources status` |
| `/youtube subscribe` | Admin, Ephemeral | Adauga un canal YouTube in lista urmarita folosind un link, un handle @nume sau un channel ID. Videoclipurile mai vechi de o luna sunt ignorate, iar cele recente pot fi livrate la prima activare. | `/youtube subscribe canal:@numeCanal` |
| `/youtube unsubscribe` | Admin, Ephemeral | Scoate un canal YouTube din lista urmarita. Autocomplete afiseaza numai canalele salvate pe server. | `/youtube unsubscribe canal:UCxxxxxxxxxxxxxxxxxxxxxx` |
| `/youtube list` | Admin, Ephemeral | Listeaza canalele YouTube urmarite, ultima verificare si ultima eroare cunoscuta pentru fiecare. | `/youtube list` |
| `/youtube notify channel` | Admin, Ephemeral | Seteaza canalul Discord unde botul posteaza videoclipurile noi si verifica permisiunile View Channel, Send Messages si Embed Links. | `/youtube notify channel channel:#youtube` |
| `/youtube notify on` | Admin, Ephemeral | Porneste postarile automate pentru canalele YouTube urmarite, folosind canalul Discord configurat. | `/youtube notify on` |
| `/youtube notify off` | Admin, Ephemeral | Opreste postarile automate fara sa stearga lista canalelor YouTube urmarite. | `/youtube notify off` |
| `/youtube notify status` | Admin, Ephemeral | Afiseaza starea notificarilor, canalul Discord, numarul de canale urmarite, filtrele si erorile recente. | `/youtube notify status` |
| `/youtube filter shorts` | Admin, Ephemeral | Activeaza sau dezactiveaza filtrul care evita videoclipurile YouTube Shorts si clipurile de cel mult 60 de secunde. | `/youtube filter shorts state:on` |
| `/youtube filter lives` | Admin, Ephemeral | Activeaza sau dezactiveaza filtrul care evita continutul marcat de YouTube ca livestream. | `/youtube filter lives state:on` |
| `/youtube filter premieres` | Admin, Ephemeral | Activeaza sau dezactiveaza filtrul care evita premierele programate. | `/youtube filter premieres state:on` |
| `/youtube filter min-duration` | Admin, Ephemeral | Seteaza durata minima acceptata pentru un videoclip. Valoarea 0 dezactiveaza limita. | `/youtube filter min-duration seconds:61` |
| `/youtube filter status` | Admin, Ephemeral | Afiseaza filtrele YouTube active si durata minima configurata. | `/youtube filter status` |
| `/youtube add channel-route` | Admin, Ephemeral | Adauga un canal Discord special pentru un canal YouTube urmarit. Cand exista rute speciale, canalul principal nu mai primeste videoclipurile acelui canal YouTube. | `/youtube add channel-route canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:#creator` |
| `/youtube remove channel-route` | Admin, Ephemeral | Sterge o ruta Discord sau toate rutele speciale ale canalului YouTube ales. Dupa eliminarea tuturor se foloseste din nou canalul principal. | `/youtube remove channel-route canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:toate` |
| `/youtube channel-route list` | Admin, Ephemeral | Listeaza toate rutele speciale dintre canalele YouTube si canalele Discord. | `/youtube channel-route list` |
| `/youtube add title-filter` | Admin, Ephemeral | Adauga un cuvant sau o expresie in filtrul inclusiv. Cand lista nu este goala, un titlu trece daca include cel putin una dintre valori. | `/youtube add title-filter word:patch notes` |
| `/youtube remove title-filter` | Admin, Ephemeral | Elimina o valoare din filtrul inclusiv de titlu. | `/youtube remove title-filter word:patch notes` |
| `/youtube title-filter list` | Admin, Ephemeral | Listeaza cuvintele si expresiile acceptate de filtrul inclusiv de titlu. | `/youtube title-filter list` |
| `/youtube title-filter clear` | Admin, Ephemeral | Goleste filtrul inclusiv, astfel incat titlul sa nu mai fie restrictionat. | `/youtube title-filter clear` |
| `/youtube status` | Admin, Ephemeral | Afiseaza starea completa a modulului YouTube: notificari, canal Discord, canale urmarite, ultima verificare, erori si filtre. | `/youtube status` |
| `/youtube clear-errors` | Admin, Ephemeral | Curata istoricul local al erorilor YouTube dupa ce problema a fost investigata sau rezolvata. | `/youtube clear-errors` |
| `/backup list` | Admin, Ephemeral | Afiseaza backup-urile salvate pentru server si cine le-a creat. | `/backup list` |
| `/backup add` | Admin, Ephemeral | Salveaza configuratia curenta a botului intr-un backup numit; foloseste aceeasi logica precum aliasul /add backup. | `/backup add name:inainte-youtube` |
| `/backup preview` | Admin, Ephemeral | Arata ce setari, canale si roluri vor fi restaurate daca incarci backup-ul ales. | `/backup preview name:inainte-youtube` |
| `/backup load` | Admin, Ephemeral | Incarca un backup salvat si restaureaza configuratia botului pentru server. Cere confirmare explicita. | `/backup load name:inainte-youtube confirm:true` |
| `/backup delete` | Admin, Ephemeral | Sterge un backup salvat. Cere confirmare explicita ca sa nu fie sters accidental. | `/backup delete name:inainte-youtube confirm:true` |
| `/bot-log recent` | Admin, Ephemeral | Afiseaza cele mai recente comenzi admin executate pe server, cu user, comanda, data si rezultat. | `/bot-log recent numar:10` |
| `/bot-log older` | Admin, Ephemeral | Afiseaza comenzi admin dintr-o zi, o saptamana sau o luna anume. Pentru luna foloseste start in format YYYY-MM; pentru zi si saptamana foloseste YYYY-MM-DD. | `/bot-log older period:luna start:2025-08` |
| `/server-log recent` | Admin, Ephemeral | Afiseaza cele mai recente schimbari importante salvate pentru server. | `/server-log recent numar:10` |
| `/server-log older` | Admin, Ephemeral | Afiseaza schimbari server dintr-o zi, o saptamana sau o luna anume. Pentru luna foloseste start in format YYYY-MM; pentru zi si saptamana foloseste YYYY-MM-DD. | `/server-log older period:luna start:2025-08` |
| `/reset-config` | Admin, Ephemeral | Reseteaza toate setarile botului pentru server la valorile implicite. Istoricul rapoartelor si al notificarilor ramane pastrat. Nota: Resetarea ruleaza numai cand confirm este true. | `/reset-config confirm:true` |
| `/admin-alerts set` | Admin, Ephemeral | Seteaza canalul in care botul trimite alerte administrative despre erori operationale, dead-letter, permisiuni si rapoarte noi. | `/admin-alerts set channel:#bot-logs` |
| `/admin-alerts off` | Admin, Ephemeral | Opreste livrarea alertelor administrative in Discord pentru server. | `/admin-alerts off` |
| `/admin-command-access list` | Admin top-level, owner-only runtime, Ephemeral | Afiseaza regula globala si regulile dedicate pe comenzi admin. Cu command afiseaza regula exacta pentru comanda aleasa sau fallback-ul global folosit. | `/admin-command-access list command:/start updates` |
| `/delete admin-command-access` | Admin top-level, owner-only runtime, Ephemeral | Sterge regula de rol globala sau regula dedicata unei comenzi admin si revine la fallback-ul ramas: regula globala, Administrator sau cod global de acces. | `/delete admin-command-access confirm:true command:/start updates` |
| `/delete suggest-command` | Admin, Ephemeral | Sterge o comanda sugerata din lista serverului impreuna cu descrierea ei. | `/delete suggest-command name:calendar` |
| `/delete watchlist-game` | Admin, Ephemeral | Sterge un joc din lista propunerilor pentru watchlist; foloseste aceeasi logica precum /watchlist-game delete. | `/delete watchlist-game game:silksong` |
| `/maintenance` | Admin, Ephemeral | Afiseaza zonele operationale care trebuie verificate: surse cu erori, outbox, dead-letter, backup vechi, canale lipsa si notificari oprite. | `/maintenance` |
| `/template set` | Admin, Ephemeral | Seteaza template-ul unei comenzi si valideaza placeholder-ele acceptate. | `/template set command:/start updates text:{count} update-uri noi` |
| `/template reset` | Admin, Ephemeral | Sterge template-ul personalizat si revine la valoarea implicita. | `/template reset command:/start updates` |
| `/template status` | Admin, Ephemeral | Afiseaza template-ul activ, valoarea implicita si placeholder-ele disponibile. | `/template status command:/youtube notify on` |
| `/game-alias add` | Admin, Ephemeral | Adauga un nume alternativ unic pentru un joc pe server. | `/game-alias add joc:counter-strike-2 alias:cs2` |
| `/game-alias remove` | Admin, Ephemeral | Sterge un alias personalizat al jocului. | `/game-alias remove joc:counter-strike-2 alias:cs2` |
| `/game-alias list` | Admin, Ephemeral | Listeaza aliasurile personalizate salvate pentru joc. | `/game-alias list joc:counter-strike-2` |
| `/notification preview` | Admin, Ephemeral | Previzualizeaza continutul si embed-ul unei notificari cu template-ul activ, fara livrare sau modificarea starii. | `/notification preview command:/start updates` |
| `/lock-channel` | Admin, Ephemeral | Blocheaza mesajele membrilor, salveaza starea exacta allow/deny/inherit si accepta motiv text fara linkuri sau atasament direct. | `/lock-channel canal:#general motiv:mentenanta` |
| `/unlock-channel` | Admin, Ephemeral | Restaureaza exact permisiunea Send Messages existenta inainte de blocare. | `/unlock-channel canal:#general` |
| `/purge` | Admin, Ephemeral | Sterge pana la 50 de mesaje recente si explica limita Discord de 14 zile si mesajele omise. | `/purge` |
| `/purge-amount` | Admin, Ephemeral | Sterge pana la numarul indicat de mesaje recente si raporteaza mesajele omise. | `/purge-amount numar:50` |
| `/timeout` | Admin, Ephemeral | Aplica timeout atomic fata de persistenta; motivul poate fi text fara linkuri sau atasament direct. | `/timeout utilizator:@user durata:30m` |
| `/remove-timeout` | Admin, Ephemeral | Elimina timeout-ul unui membru. | `/remove-timeout utilizator:@user` |
| `/timeout-list` | Public | Afiseaza timeout-urile active. | `/timeout-list` |
| `/mute` | Admin, Ephemeral | Aplica mute atomic fata de persistenta; motivul poate fi text fara linkuri sau atasament direct. | `/mute utilizator:@user durata:1h` |
| `/unmute` | Admin, Ephemeral | Elimina mute-ul unui membru. | `/unmute utilizator:@user` |
| `/mute-list` | Public | Afiseaza mute-urile active. | `/mute-list` |
| `/kick` | Admin, Ephemeral | Elimina un membru de pe server. | `/kick utilizator:@user` |
| `/ban` | Admin, Ephemeral | Baneaza un membru. | `/ban utilizator:@user` |
| `/unban` | Admin, Ephemeral | Debaneaza utilizatorul prin API-ul guild.bans.remove. | `/unban utilizator:@user` |
| `/warn` | Admin, Ephemeral | Publica dovada intr-un canal dedicat, persista doar metadatele si poate declansa auto-ban. | `/warn utilizator:@user motiv:spam` |
| `/remove-warn` | Admin, Ephemeral | Elimina cel mai recent avertisment. | `/remove-warn utilizator:@user` |
| `/warn-list` | Public | Afiseaza sumarul avertismentelor grupat pe utilizator: totalul de warn-uri active, sortat descrescator, cu data ultimului warn. | `/warn-list` |
| `/warn-ban-limit` | Admin, Ephemeral | Seteaza limita de avertismente pentru ban automat. | `/warn-ban-limit numar:3` |
| `/permission-request` | Public | Cere aprobarea ownerului pentru o operatiune de securitate: bot-add, permission-grant, moderation-mass, webhook, server-structure sau protected-resource-change. | `/permission-request type:webhook target:#anunturi action:create reason:integrare RSS` |
| `/permission-requests list` | Admin top-level, owner-only runtime, Ephemeral | Listeaza cererile de aprobare de securitate, cu filtre optionale dupa status si tip; cele active apar inaintea istoricului. | `/permission-requests list status:pending` |
| `/ad-request` | Public | Cere aprobarea proprietarului inainte sa publici o reclama. Cererea salveaza utilizatorul, textul exact, linkul, invitatia si atasamentul; aprobarea e legata de reclama si utilizatorul exacte, se foloseste o singura data si expira. | `/ad-request reclama:Intra pe serverul meu` |
| `/ad-permissions list` | Admin top-level, owner-only runtime, Ephemeral | Afiseaza cererile si aprobarile pentru reclame, cu ID, utilizator, rezumatul reclamei, status, data solicitarii, decizia ownerului, expirarea si folosirea. Cererile active apar inaintea istoricului. | `/ad-permissions list` |
| `/ad-attempts list` | Admin, Ephemeral | Afiseaza tentativele active 0/3, 1/3 sau 2/3 ale unui membru, totalul reclamelor sterse, warn-urile automate, ultima tentativa, canalul si istoricul grupurilor de trei tentative. | `/ad-attempts list utilizator:@membru` |
| `/anti-raid status` | Admin, Ephemeral | Arata incidentul anti-raid activ sau ultimul: ID, etapa, canalele blocate acum, participantii opriti si cei ramasi, durata lockdown-ului, timpul ramas din perioada de siguranta, progresul restaurarii, operatiunile ramase si erorile. | `/anti-raid status` |
| `/anti-raid participant-list` | Admin, Ephemeral | Listeaza participantii incidentului activ, ai ultimului raid sau ai incidentului indicat, cu sanctiunile aplicate, cele esuate si ultima eroare. | `/anti-raid participant-list incident-id:raid-abc` |
| `/anti-raid force-start` | Admin top-level, owner-only runtime, Ephemeral | Confirma manual un raid, genereaza un ID de incident si porneste interventia. Owner-only. | `/anti-raid force-start` |
| `/anti-raid force-stop` | Admin top-level, owner-only runtime, Ephemeral | Incheie manual interventia si porneste restaurarea controlata. Se poate folosi numai dupa un raid confirmat si nu anuleaza sanctiunile aplicate. Owner-only. | `/anti-raid force-stop confirm:true` |
| `/anti-raid participant-add` | Admin top-level, owner-only runtime, Ephemeral | Adauga manual un participant omis si il introduce in fluxul Mute 24h -> Timeout 24h -> Ban. Owner-only. | `/anti-raid participant-add utilizator:@membru` |
| `/anti-raid participant-remove` | Admin top-level, owner-only runtime, Ephemeral | Elimina din incident un participant identificat gresit. NU anuleaza automat sanctiunile deja aplicate. Owner-only. | `/anti-raid participant-remove utilizator:@membru` |
| `/protected-resource` | Admin top-level, owner-only runtime, Ephemeral | Marcheaza canale, categorii si roluri ca resurse critice. add salveaza snapshot-ul si evalueaza daca prevenirea poate fi garantata, remove scoate resursa din protectie fara sa o stearga, list arata resursele, starea snapshot-ului si cauzele exacte pentru cele degraded. Nota: Aplicarea in afara raidurilor porneste doar cand /start moderation-guard este activ. Nota: O resursa e marcata degraded cand prevenirea nu poate fi garantata, de exemplu roluri cu Administrator care ignora overwrite-urile canalului sau un rol protejat mai sus decat rolul botului. | `/protected-resource action:add type:channel target:123456789012345678` |
