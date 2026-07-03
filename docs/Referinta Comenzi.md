# Referinta Comenzi

> Fisier generat automat din `COMMAND_CATALOG_HELP` (`src/features/command-catalog/commandCatalog.ts`), aceeasi sursa unica pe care o foloseste comanda `/help` in Discord. Nu edita manual acest fisier: ruleaza `npm run docs:commands` din `src/`. Sincronizarea catalog <-> fisier este verificata de `commandReferenceDoc.test.ts` si de `npm run check:docs-commands`.

Total comenzi documentate: 122.

| Comanda | Permisiuni | Ce face | Exemplu |
| --- | --- | --- | --- |
| `/ping` | Public | Verifica rapid daca botul raspunde la Discord. | `/ping` |
| `/games` | Public | Listeaza jocurile cunoscute de bot si cheile/poreclele pe care le poti folosi in comenzile cu joc. | `/games` |
| `/help` | Public | Afiseaza meniul general de ajutor. Daca alegi o comanda in optiunea command, primesti explicatia detaliata pentru comanda aceea. | `/help command:/set add games` |
| `/config` | Admin, Ephemeral | Afiseaza intr-un singur loc setarile curente ale serverului: mode, filtre de reduceri, valuta, store-uri, jocuri active, roluri si canale. | `/config` |
| `/add backup` | Admin runtime, Ephemeral | Salveaza configuratia curenta a botului pentru server intr-un backup numit. Backup-ul include canale, roluri, filtre, watchlist, snooze-uri, alerte de pret si configurarea YouTube. | `/add backup name:inainte-youtube` |
| `/backup list` | Admin, Ephemeral | Afiseaza backup-urile salvate pentru server si cine le-a creat. | `/backup list` |
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
| `/set admin-command-access` | Admin top-level, owner-only runtime, Ephemeral | Seteaza rolul care poate folosi comenzile admin pe langa Administrator si codul global de acces. Fara command seteaza fallback-ul global; cu command seteaza regula doar pentru acea comanda sau acel pachet, de exemplu /start updates. Perechile start/stop pentru acelasi modul folosesc aceeasi regula. Nota: Mode `role` accepta doar rolul ales, iar `role-or-higher` accepta rolul ales sau unul mai mare. Nota: O regula pentru `/start player-count` se aplica automat si la `/stop player-count`. Nota: Pana ownerul seteaza o regula de rol, rolurile nu dau acces admin; raman Administrator si codul global corect introdus prin modal ephemeral. | `/set admin-command-access role:@Moderator mode:role-or-higher command:/start player-count` |
| `/admin-command-access list` | Admin top-level, owner-only runtime, Ephemeral | Afiseaza regula globala si regulile dedicate pe comenzi admin. Cu command afiseaza regula exacta pentru comanda aleasa sau fallback-ul global folosit. | `/admin-command-access list command:/start updates` |
| `/delete admin-command-access` | Admin top-level, owner-only runtime, Ephemeral | Sterge regula de rol globala sau regula dedicata unei comenzi admin si revine la fallback-ul ramas: regula globala, Administrator sau cod global de acces. | `/delete admin-command-access confirm:true command:/start updates` |
| `/add price-alert` | Admin runtime, Ephemeral | Adauga sau actualizeaza o alerta care se declanseaza cand jocul ajunge la sau sub pragul ales, in valuta aleasa. Nota: Alerta foloseste canalul configurat prin /start reduceri si se rearmeaza dupa ce pretul urca din nou peste prag. | `/add price-alert joc:elden-ring price:30 currency:EUR` |
| `/remove price-alert` | Admin runtime, Ephemeral | Sterge toate alertele de pret configurate pentru jocul ales. | `/remove price-alert joc:elden-ring` |
| `/price-alert list` | Admin, Ephemeral | Listeaza alertele de pret, pragurile, valutele si starea armata sau declansata. | `/price-alert list` |
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
| `/top active games` | Public | Afiseaza topul global al jocurilor cunoscute de bot care au Steam appId, sortat dupa player-count Steam. Nu este limitat de watchlist-ul sau filtrul de jocuri al serverului. | `/top active games numar:5` |
| `/add suggestion` | Public, Ephemeral | Permite unui user sa propuna o comanda noua, cu numele si descrierea functionalitatii dorite. | `/add suggestion name:calendar description:Sa arate urmatoarele update-uri programate` |
| `/suggest-command list` | Admin runtime, Ephemeral | Listeaza comenzile propuse de useri pe server, cu numele propus si ce ar trebui sa faca. | `/suggest-command list numar:10` |
| `/suggest-command delete` | Admin runtime, Ephemeral | Sterge o comanda sugerata din lista serverului impreuna cu descrierea ei. | `/suggest-command delete name:calendar` |
| `/watchlist-game add` | Public, Ephemeral | Permite unui user sa propuna un joc nou pentru lista botului. Propunerea nu activeaza jocul automat. | `/watchlist-game add game:silksong` |
| `/watchlist-game list` | Public, Ephemeral | Afiseaza jocurile propuse de useri pentru a fi adaugate in lista botului. | `/watchlist-game list numar:10` |
| `/watchlist-game delete` | Admin runtime, Ephemeral | Sterge un joc din lista de propuneri watchlist-game. | `/watchlist-game delete game:silksong` |
| `/future-release add` | Admin, Ephemeral | Adauga un joc care urmeaza sa apara in lista future-release a serverului. Lista are maxim 20 de jocuri. | `/future-release add game:silksong release-date:2026 preorder-price:indisponibil` |
| `/future-release list` | Admin, Ephemeral | Afiseaza jocurile future-release urmarite, data lansarii si pretul de preorder daca sunt salvate. | `/future-release list` |
| `/future-release delete` | Admin, Ephemeral | Sterge un joc din lista future-release. | `/future-release delete game:silksong` |
| `/future-release start` | Admin, Ephemeral | Configureaza canalul curent pentru notificarile future-release si marcheaza modulul activ pentru server. | `/future-release start` |
| `/future-release stop` | Admin, Ephemeral | Opreste notificarile future-release si sterge canalul salvat pentru acest modul. | `/future-release stop` |
| `/maintenance` | Admin, Ephemeral | Afiseaza zonele operationale care trebuie verificate: surse cu erori, outbox, dead-letter, backup vechi, canale lipsa si notificari oprite. | `/maintenance` |
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
| `/youtube message-template set` | Admin, Ephemeral | Seteaza textul atasat notificarilor YouTube. Sunt acceptate variabilele {channel}, {title} si {url}; mentiunile Discord sunt dezactivate. | `/youtube message-template set text:Video nou de la {channel}: {title} {url}` |
| `/youtube message-template reset` | Admin, Ephemeral | Sterge sablonul personalizat si revine la mesajul YouTube implicit. | `/youtube message-template reset` |
| `/youtube message-template status` | Admin, Ephemeral | Afiseaza sablonul de mesaj YouTube folosit in prezent. | `/youtube message-template status` |
| `/youtube add channel-route` | Admin, Ephemeral | Adauga un canal Discord special pentru un canal YouTube urmarit. Cand exista rute speciale, canalul principal nu mai primeste videoclipurile acelui canal YouTube. | `/youtube add channel-route canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:#creator` |
| `/youtube remove channel-route` | Admin, Ephemeral | Sterge o ruta Discord sau toate rutele speciale ale canalului YouTube ales. Dupa eliminarea tuturor se foloseste din nou canalul principal. | `/youtube remove channel-route canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:toate` |
| `/youtube channel-route list` | Admin, Ephemeral | Listeaza toate rutele speciale dintre canalele YouTube si canalele Discord. | `/youtube channel-route list` |
| `/youtube add title-filter` | Admin, Ephemeral | Adauga un cuvant sau o expresie in filtrul inclusiv. Cand lista nu este goala, un titlu trece daca include cel putin una dintre valori. | `/youtube add title-filter word:patch notes` |
| `/youtube remove title-filter` | Admin, Ephemeral | Elimina o valoare din filtrul inclusiv de titlu. | `/youtube remove title-filter word:patch notes` |
| `/youtube title-filter list` | Admin, Ephemeral | Listeaza cuvintele si expresiile acceptate de filtrul inclusiv de titlu. | `/youtube title-filter list` |
| `/youtube title-filter clear` | Admin, Ephemeral | Goleste filtrul inclusiv, astfel incat titlul sa nu mai fie restrictionat. | `/youtube title-filter clear` |
| `/youtube videos show` | Admin, Ephemeral | Posteaza manual videoclipurile din ultima luna pentru un canal urmarit sau pentru toate. Revendica (claim) videoclipurile pe care le posteaza, deci o a doua rulare nu le mai reposteaza (foloseste `repeta:true` ca sa le repostezi); peste 5 rezultate sunt trimise in loturi de 5 la 10 minute, iar loturile suplimentare merg prin outbox-ul durabil cand e activat, chiar daca notificarile automate sunt oprite. | `/youtube videos show canal:toate` |
| `/youtube status` | Admin, Ephemeral | Afiseaza starea completa a modulului YouTube: notificari, canal Discord, canale urmarite, ultima verificare, erori si filtre. | `/youtube status` |
| `/youtube errors` | Admin, Ephemeral | Afiseaza ultimele erori de rezolvare canal, citire feed, metadate video sau livrare Discord. | `/youtube errors` |
| `/youtube permissions` | Admin, Ephemeral | Verifica permisiunile botului pe canalul principal YouTube si pe canalele din rutele speciale (`/youtube add channel-route`). | `/youtube permissions` |
| `/youtube clear-errors` | Admin, Ephemeral | Curata istoricul local al erorilor YouTube dupa ce problema a fost investigata sau rezolvata. | `/youtube clear-errors` |
| `/snooze` | Admin, Ephemeral | Pune temporar pe pauza o comanda existenta a botului pentru server. Comanda aleasa vine din autocomplete, iar durata accepta valori precum 30m, 2h sau 1d. Nota: Nu poate opri /snooze sau /unsnooze, ca adminii sa poata gestiona mereu pauzele. | `/snooze command:/latest updates durata:2h` |
| `/unsnooze` | Admin, Ephemeral | Scoate pauza temporara de pe o comanda pusa anterior in snooze. | `/unsnooze command:/latest updates` |
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
| `/set outbox-recovery-verify` | Admin, Ephemeral | Activeaza sau dezactiveaza verificarea de recovery pentru outbox pe server. Cand este activa, botul verifica istoricul canalului ca sa previna retrimiterea aceluiasi mesaj dupa un crash. | `/set outbox-recovery-verify value:on` |
| `/set add games` | Admin, Ephemeral | Adauga un joc deja cunoscut de bot in lista explicita de jocuri active pentru server. Nota: Nu adauga un joc nou in codul botului; doar activeaza pentru server un joc existent in configuratie. | `/set add games joc:cs2` |
| `/set remove games` | Admin, Ephemeral | Scoate un joc din lista explicita de jocuri active pentru server. | `/set remove games joc:cs2` |
| `/set games reset` | Admin, Ephemeral | Reseteaza filtrul per-joc. Dupa reset, serverul foloseste toate jocurile cunoscute de bot. | `/set games reset` |
| `/watchlist show` | Admin, Ephemeral | Afiseaza jocurile urmarite explicit pe server. Daca lista este goala, serverul foloseste toate jocurile configurate. | `/watchlist show` |
| `/add watchlist` | Admin runtime, Ephemeral | Adauga un joc deja cunoscut de bot in watchlist-ul serverului. | `/add watchlist joc:cs2` |
| `/remove watchlist` | Admin runtime, Ephemeral | Scoate un joc din watchlist-ul serverului. | `/remove watchlist joc:cs2` |
| `/watchlist reset` | Admin, Ephemeral | Reseteaza watchlist-ul. Dupa reset, toate jocurile configurate sunt active. | `/watchlist reset` |
| `/set role updates` | Admin, Ephemeral | Seteaza rolul pingat la notificarile de update-uri. Daca nu alegi rol, ping-ul se opreste. | `/set role updates value:@Updates` |
| `/set role discounts` | Admin, Ephemeral | Seteaza rolul pingat la alertele de reduceri. Daca nu alegi rol, ping-ul se opreste. | `/set role discounts value:@Deals` |
| `/outbox status` | Admin, Ephemeral | Afiseaza starea cozii de notificari: cate mesaje asteapta livrare, cate sunt in dead-letter, daca drenarea e pe pauza si starea recovery-verify. Nota: Outbox inseamna coada persistenta in MongoDB in care botul pune mesajele de trimis, ca sa nu le piarda la restart sau erori temporare. | `/outbox status` |
| `/outbox deadletters` | Admin, Ephemeral | Listeaza livrarile care au esuat definitiv si au fost mutate in dead-letter pentru investigare. Nota: Dead-letter inseamna lista de mesaje pe care botul nu le mai retrimite automat fiindca problema pare permanenta sau a depasit numarul de incercari. | `/outbox deadletters` |
| `/outbox clear-deadletters` | Admin, Ephemeral | Sterge raportarea dead-letter pentru server dupa ce ai investigat cauza. Nu repara problema si nu retrimite mesajele. | `/outbox clear-deadletters` |
| `/outbox replay-deadletters` | Admin, Ephemeral | Reintroduce in outbox livrarile dead-letter care mai au payload salvat, ca botul sa incerce sa le trimita din nou. Nota: Foloseste comanda doar dupa ce ai reparat cauza, de exemplu canal lipsa sau permisiuni insuficiente. | `/outbox replay-deadletters` |
| `/outbox retry` | Admin, Ephemeral | Reprogrameaza joburile din coada serverului pentru livrare imediata. | `/outbox retry` |
| `/outbox drain-now` | Admin, Ephemeral | Porneste manual o drenare a outbox-ului daca drenarea nu este pe pauza si lock-ul global este liber. Nota: Drain inseamna procesul prin care botul ia mesajele din coada persistenta si incearca sa le trimita pe Discord. | `/outbox drain-now` |
| `/outbox pause` | Admin, Ephemeral | Pune pe pauza drenarea globala a outbox-ului. Mesajele pot ramane in coada, dar worker-ul nu le livreaza pana la resume. | `/outbox pause` |
| `/outbox resume` | Admin, Ephemeral | Reia drenarea globala a outbox-ului dupa o pauza. | `/outbox resume` |
| `/outbox permissions` | Admin, Ephemeral | Auditeaza permisiunile botului pe canalele configurate pentru notificari si reduceri. Nota: Verifica View Channel, Send Messages, Embed Links si Read Message History cand recovery-verify are nevoie de istoric. | `/outbox permissions` |
| `/outbox recovery-verify status` | Admin, Ephemeral | Afiseaza starea recovery-verify pentru server si configuratia globala relevanta. Nota: Recovery-verify este stratul care cauta markerul mesajului in istoricul canalului dupa crash, ca botul sa evite duplicatele. | `/outbox recovery-verify status` |
| `/latest updates` | Public | Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache si poate folosi snapshot-ul persistat daca fetch-ul live esueaza. | `/latest updates` |
| `/latest reduceri` | Public | Afiseaza cele mai bune reduceri curente care trec filtrele serverului. | `/latest reduceri` |
| `/latest update` | Public | Cauta ultimul update pentru un joc anume. | `/latest update joc:cs2` |
| `/latest pret` | Public | Cauta pretul curent al unui joc pe Steam. | `/latest pret joc:Counter-Strike 2` |
| `/dlc` | Public | Cauta DLC-uri pentru un joc. | `/dlc joc:Counter-Strike 2` |
| `/status` | Public | Afiseaza statusul unei surse sau al unui joc urmarit. | `/status joc:minecraft` |
| `/sources status` | Admin, Ephemeral | Afiseaza starea ultimelor snapshot-uri pentru sursele de date: reduceri Steam/Epic, feed-uri de update si vechimea ultimului fetch. | `/sources status` |
| `/history` | Public, Ephemeral | Afiseaza istoricul recent al notificarilor trimise pe server, filtrat optional dupa update-uri, reduceri sau YouTube. | `/history tip:youtube numar:10` |
| `/report submit` | Public, Ephemeral | Trimite un raport despre o problema observata la bot, de exemplu sursa stricata, pret gresit sau update lipsa. | `/report submit tip:sursa-stricata detalii:Steam nu raspunde` |
| `/report list` | Admin runtime, Ephemeral | Listeaza rapoartele recente ale serverului, cu ID-ul necesar pentru rezolvare. | `/report list numar:10` |
| `/report resolve` | Admin runtime, Ephemeral | Marcheaza un raport ca rezolvat dupa ce problema a fost verificata sau reparata. | `/report resolve id:64a1f2b3c4d5e6f789012345` |
| `/health` | Admin, Ephemeral | Afiseaza starea tehnica a botului: conexiune Discord, MongoDB, uptime si cache. | `/health` |
