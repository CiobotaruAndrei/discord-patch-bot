# Comenzi Functionalitate

Acest fisier documenteaza comenzile slash expuse de bot si rolul fiecareia in comportamentul curent al repo-ului.

> Pentru o lista completa, mereu sincronizata cu codul, vezi [Referinta Comenzi](./Referinta%20Comenzi.md) — un tabel generat automat din `COMMAND_CATALOG_HELP` (aceeasi sursa unica folosita de `/help`), regenerat cu `npm run docs:commands` si verificat anti-drift de `npm run check:docs-commands`. Sectiunile de mai jos raman explicatia narativa, grupata pe functionalitate.

## Legenda

- `Admin`: comanda cere permisiunea Discord `Administrator`.
- `Autocomplete`: optiunea ofera sugestii Discord din jocurile/configuratia cunoscuta de bot.
- `Ephemeral`: raspunsul este vizibil doar pentru utilizatorul care a rulat comanda.

## Comenzi publice de baza

| Comanda | Ce face |
| --- | --- |
| `/ping` | Verifica daca botul raspunde si intoarce `Pong!`. |
| `/games` | Listeaza jocurile urmarite de bot, cu cheile si poreclele acceptate. |
| `/help` | Afiseaza meniul de ajutor cu principalele comenzi si categorii. |
| `/help command:<comanda>` | Afiseaza ephemeral explicatia detaliata pentru o comanda exacta. Optiunea `command` are autocomplete cu comenzile existente, de exemplu `/game overview`, `/set add games` sau `/latest pret`. |

## Pauze temporare pentru comenzi

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/snooze command:<comanda> durata:<timp>` | Admin, Ephemeral | Pune temporar pe pauza o comanda existenta a botului pentru server. Optiunea `command` are autocomplete ca `/help command`, iar `durata` accepta valori precum `30m`, `2h` sau `1d`. Nu poate opri `/snooze` sau `/unsnooze`, ca adminii sa poata gestiona mereu pauzele. |
| `/unsnooze command:<comanda>` | Admin, Ephemeral | Scoate pauza temporara de pe comanda aleasa inainte sa expire automat. Foloseste acelasi autocomplete pe comenzile existente. |

## Notificari automate

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/start updates` | Admin, Ephemeral | Porneste notificarile automate de update-uri in canalul curent. Verifica permisiunile canalului, salveaza canalul in setarile serverului si face baseline initial ca sa nu trimita update-uri vechi. |
| `/start reduceri` | Admin, Ephemeral | Porneste alertele automate de reduceri in canalul curent. Verifica permisiunile canalului, salveaza canalul si face baseline initial pentru ofertele deja vazute. |
| `/start dlc` | Admin, Ephemeral | Configureaza canalul curent pentru notificarile DLC ale jocurilor active. Verifica permisiunile canalului si salveaza starea necesara pentru motorul DLC cand acesta ruleaza in runtime. |
| `/start player-count game:<key>` | Admin, Autocomplete, Ephemeral | Adauga atomic jocul in lista urmarita, salveaza canalul si creeaza un baseline real Steam fara notificare retroactiva. Detectiile ulterioare folosesc esantioane ordonate temporal, dedupe persistent, cooldown si confirmarea inversarii de trend ca sa evite alertele oscilante. Jocul trebuie sa aiba Steam appId configurat. |
| `/stop updates` | Admin, Ephemeral | Opreste notificarile automate de update-uri pentru server si curata coada/starea aferenta. |
| `/stop reduceri` | Admin, Ephemeral | Opreste alertele automate de reduceri pentru server si curata coada/starea aferenta. |
| `/stop dlc` | Admin, Ephemeral | Opreste notificarile DLC si sterge canalul salvat pentru acest modul. |
| `/stop player-count game:<key>` | Admin, Autocomplete, Ephemeral | Scoate atomic jocul din lista player-count si curata starea de semnal aferenta. Daca nu mai ramane niciun joc, modulul este oprit pentru server. |

## Setari server

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set mode value:<compact|detailed>` | Admin, Ephemeral | Alege modul de afisare al embed-urilor. `compact` afiseaza mai scurt, `detailed` include mai multe detalii. |
| `/set mindiscount value:<0-100>` | Admin, Ephemeral | Seteaza procentul minim de reducere acceptat pentru alertele de reduceri. Reseteaza coada de reduceri in asteptare. |
| `/set maxprice value:<0-10000>` | Admin, Ephemeral | Seteaza pretul maxim absolut pentru reduceri. Valoarea `0` dezactiveaza limita. Reseteaza coada de reduceri in asteptare. |
| `/set free value:<on|off>` | Admin, Ephemeral | Activeaza sau dezactiveaza afisarea jocurilor gratuite in alertele de reduceri. Reseteaza coada de reduceri in asteptare. |
| `/set paid value:<on|off>` | Admin, Ephemeral | Activeaza sau dezactiveaza afisarea ofertelor platite in alertele de reduceri. Reseteaza coada de reduceri in asteptare. |
| `/set currency value:<currency>` | Admin, Ephemeral | Seteaza valuta folosita pentru preturi si reduceri. Optiunile vin din registrul de valute suportate de bot. Reseteaza coada de reduceri in asteptare. |
| `/set stores value:<steam,epic|reset>` | Admin, Ephemeral | Filtreaza reducerile dupa magazinele permise. `reset` revine la filtrul implicit. Reseteaza coada de reduceri in asteptare. |
| `/template set command:<comanda> text:<text>` | Admin, Autocomplete, Ephemeral | Seteaza template-ul activ pentru comanda aleasa. Valideaza lungimea si placeholder-ele permise si pastreaza campurile existente pentru update-uri, reduceri si YouTube. |
| `/template reset command:<comanda>` | Admin, Autocomplete, Ephemeral | Revine la template-ul implicit al comenzii alese. |
| `/template status command:<comanda>` | Admin, Autocomplete, Ephemeral | Afiseaza template-ul activ, valoarea implicita si placeholder-ele acceptate. |
| `/notification preview command:<comanda>` | Admin, Autocomplete, Ephemeral | Randaza template-ul activ cu date demo realiste, fara sa trimita notificari si fara sa modifice deduplicarea sau configuratia. |
| `/set admin-command-access` | Owner-only, Ephemeral | Seteaza conditia de rol pentru folosirea comenzilor admin. Primeste `role`, `mode` si optional `command`. Fara `command`, regula devine fallback global. Cu `command`, regula se aplica doar acelei comenzi sau acelui pachet, de exemplu `/start updates`. Pentru perechile `start`/`stop`, regula este comuna: `/start player-count` acopera automat si `/stop player-count`. `command` trebuie sa fie o comanda admin care trece prin verificarea de rol configurabila (aleasa din autocomplete); comenzile publice, cele owner-only si cele care isi fac propria verificare de admin (de exemplu `/suggest-command`, `/report`, `/watchlist-game`) sunt respinse, ca sa nu salvezi o regula care nu s-ar aplica niciodata. `role` accepta doar rolul ales, iar `role-or-higher` accepta rolul ales sau un rol mai mare in ierarhia Discord. |
| `/admin-command-access list` | Owner-only, Ephemeral | Afiseaza regula globala si regulile dedicate pe comenzi admin. Cu optiunea `command`, arata regula exacta pentru comanda aleasa sau fallback-ul global folosit. Semnaleaza si conflictele intre chei vechi `start:`/`stop:` cu roluri diferite pentru acelasi modul (altfel ascunse), ca sa le poti unifica reruland `/set admin-command-access` pe acel modul. |
| `/delete admin-command-access` | Owner-only, Ephemeral | Sterge regula globala sau regula dedicata comenzii alese. Cere `confirm:true`; cu optiunea `command` sterge doar regula dedicata. Daca stergi o regula dedicata, comanda revine la fallback-ul global, iar daca nu exista fallback ramane accesul implicit: `Administrator` sau cod global de acces. |
| `/config` | Admin, Ephemeral | Afiseaza setarile curente ale serverului intr-un singur embed: mod, reducere minima, pret maxim, filtre free/paid, valuta, magazine, jocuri active, roluri de ping, canale pentru update-uri/reduceri/YouTube/future-release/DLC, canalul administrativ, alertele de pret, propunerile salvate si numarul canalelor YouTube urmarite. |
| `/reset-config confirm:true` | Admin, Ephemeral | Reseteaza toate setarile botului pentru server: abonari, canale, roluri, filtre, watchlist, snooze-uri, alerte de pret, configurarea YouTube si canalul administrativ. Confirmarea trebuie sa fie explicit `true`. Goleste lista dead-letter vizibila si payload-urile de replay din colectia separata (ca sa nu ramana orfane); istoricul rapoartelor si al notificarilor deja livrate nu este sters. |

## Backup configuratie

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/backup add name:<nume>` | Admin, Ephemeral | Salveaza configuratia curenta a botului pentru server intr-un backup numit. Include abonari, canale, roluri, filtre, watchlist, snooze-uri, alerte de pret si configurarea YouTube, inclusiv structurile imbricate. `/add backup` ramane alias compatibil. Daca exista deja un backup cu acel nume, este inlocuit. |
| `/add backup name:<nume>` | Admin runtime, Ephemeral | Alias compatibil pentru `/backup add`; foloseste acelasi plan de salvare si aceeasi colectie. |
| `/backup list` | Admin, Ephemeral | Afiseaza backup-urile salvate, cine le-a creat si data crearii. Lista este limitata ca documentul serverului sa ramana controlat. |
| `/backup preview name:<nume>` | Admin, Ephemeral | Construieste planul de restaurare fara mutatii: arata setarile, canalele si rolurile care vor fi pastrate, remapate, create sau respinse si semnaleaza referintele disparute ori incompatibile. |
| `/backup load name:<nume> confirm:true` | Admin, Ephemeral | Valideaza planul, creeaza sau remapeaza resursele Discord necesare, aplica configuratia si invalideaza cache-ul numai dupa commit. La esec compenseaza resursele create si pastreaza configuratia anterioara; rezultatul complet este salvat in `server-log`. |
| `/backup delete name:<nume> confirm:true` | Admin, Ephemeral | Sterge backup-ul ales din lista de backup-uri salvate. Cere confirmare explicita ca sa evite stergerile accidentale. |

## Alerte de pret

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/add price-alert joc:<key> price:<0.01-10000> currency:<valuta>` | Admin, Autocomplete, Ephemeral | Adauga sau actualizeaza alerta pentru perechea joc+valuta. Botul cauta oferta jocului in ciclul de reduceri si trimite un embed cand pretul ajunge la sau sub prag. Alerta este salvata chiar si fara un canal activ (pregatire in avans) si foloseste canalul configurat prin `/start reduceri`: pana atunci ramane INACTIVA, iar `/price-alert list` marcheaza explicit aceasta stare. |
| `/remove price-alert joc:<key>` | Admin, Autocomplete, Ephemeral | Sterge toate alertele acelui joc, indiferent de valuta. Autocomplete-ul sugereaza numai jocurile care au alerte configurate. |
| `/price-alert list` | Admin, Ephemeral | Afiseaza fiecare alerta, pragul, valuta, ultimul pret observat si daca alerta este armata sau deja declansata. |
| `/price-check joc:<name>` | Public, Autocomplete | Cauta pretul jocului pe Steam si il compara cu ofertele similare din sursele externe de reduceri deja folosite de bot. Embed-ul are culoarea verde pentru pretul Steam; celelalte randuri arata magazinele externe gasite sau explica lipsa unei potriviri. |
| `/deal-score game:<name>` | Public, Autocomplete | Calculeaza un scor 1-10 pentru oferta activa folosind reducerea, pretul, calitatea/popularitatea si istoricul persistent de pret. Minimul si distributia istorica sunt calculate din snapshot-uri deduplicate; cand istoricul este insuficient, embed-ul declara explicit limitarea. |
| `/best deals under buget:<numar> currency:<valuta> numar:<1-10>` | Public | Cauta cele mai bune reduceri sub bugetul ales in toate sursele de deals active, nu doar in watchlist-ul serverului. Sorteaza rezultatele dupa reducere, pret, calitate si popularitate. |
| `/ending deals currency:<valuta> numar:<1-10>` | Public | Afiseaza ofertele cu termen de expirare detectat si le sorteaza dupa cat de aproape este expirarea. Daca sursele nu expun termen clar, comanda spune explicit asta. |

O alerta declansata nu este retrimisa la fiecare ciclu. Ea ramane marcata ca declansata cat timp pretul este sub prag si se rearmeaza automat cand pretul urca din nou peste prag. Claim-ul este atomic in Mongo, astfel incat doua instante ale botului nu pot trimite aceeasi alerta simultan.

## Alerte administrative

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/admin-alerts set channel:<canal>` | Admin, Ephemeral | Configureaza canalul pentru embed-uri administrative. Inainte de salvare verifica permisiunile `View Channel`, `Send Messages` si `Embed Links`. |
| `/admin-alerts off` | Admin, Ephemeral | Opreste alertele administrative Discord pentru server. Webhook-ul global, daca este configurat prin env, ramane independent. |
| `/maintenance` | Admin, Ephemeral | Afiseaza intr-un singur raspuns zonele care trebuie verificate operational: erori YouTube/update-uri/reduceri, joburi in outbox, dead-letter, drenare pusa pe pauza, backup vechi, canale lipsa pentru module active si daca exista macar un modul de notificare pornit. |

Canalul administrativ primeste alerte operationale cu severitate, cauza, explicatie si actiune recomandata. Rapoartele noi sunt directionate numai catre canalul serverului respectiv. Alertele globale despre cron, surse, outbox sau proces sunt distribuite canalelor administrative configurate. Daca un canal este sters sau botul pierde permanent accesul, configurarea acelui canal este dezactivata automat.

## Audit, loguri si sugestii de comenzi

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/bot-log recent` | Admin, Ephemeral | Afiseaza cele mai recente comenzi admin executate pe server, cu user, comanda, data, server si rezultat. Auditul este scris de guard-ul runtime pentru comenzile admin protejate. |
| `/bot-log older` | Admin, Ephemeral | Afiseaza comenzi admin dintr-o zi, saptamana sau luna. Primul lot de cel mult 25 apare imediat, apoi botul trimite automat cate un lot ephemeral la doua minute, pana la final sau cel mult 175 de intrari. La volum mai mare cere un interval mai mic. `offset` poate porni livrarea dintr-o pozitie anume. |
| `/server-log recent` | Admin, Ephemeral | Afiseaza schimbarile importante cu actorul rezolvat din Audit Log, tinta, actiunea, detaliile si ID-ul de corelare. Evenimentele duplicate sunt eliminate, iar citirea actorului are reincercari scurte pentru propagarea Discord. |
| `/server-log older` | Admin, Ephemeral | Livreaza automat istoricul serverului cu aceleasi intervale, loturi, limite si oprire sigura ca `/bot-log older`. |
| `/suggest-command name:<nume> description:<ce-face>` | Public, Ephemeral | Permite unui user sa propuna direct o comanda noua. `/add suggestion` ramane alias compatibil. |
| `/add suggestion name:<nume> description:<ce-face>` | Public, Ephemeral | Alias compatibil pentru `/suggest-command`; foloseste aceeasi validare si aceeasi colectie. |
| `/list suggest-command numar:<1-25>` | Admin runtime, Ephemeral | Afiseaza comenzile sugerate, numele si descrierea lor. |
| `/delete suggest-command name:<nume>` | Admin runtime, Ephemeral | Sterge o comanda sugerata impreuna cu descrierea ei. |

## Propuneri watchlist si future-release

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/watchlist-game add game:<nume>` | Public, Ephemeral | Permite unui user sa propuna un joc nou pentru lista botului. `/add watchlist-game` este ruta echivalenta. Propunerea este salvata separat si nu activeaza automat jocul. |
| `/add watchlist-game game:<nume>` | Public, Ephemeral | Alias compatibil pentru `/watchlist-game add`; foloseste aceeasi validare si aceeasi lista de propuneri. |
| `/watchlist-game list` | Public, Ephemeral | Afiseaza jocurile propuse de useri pentru a fi analizate de admini. |
| `/watchlist-game delete game:<nume>` | Admin runtime, Ephemeral | Sterge un joc din lista de propuneri. `/delete watchlist-game` este ruta echivalenta si are aceeasi protectie runtime. |
| `/delete watchlist-game game:<nume>` | Admin runtime, Ephemeral | Alias compatibil pentru `/watchlist-game delete`, cu aceeasi verificare de acces. |
| `/future-release add game:<nume>` | Admin, Ephemeral | Adauga un joc care urmeaza sa apara in lista future-release a serverului. Lista are maxim 20 de jocuri si poate pastra data lansarii si pretul de preorder daca sunt cunoscute. |
| `/future-release list` | Public | Afiseaza jocurile future-release urmarite, data lansarii si pretul de preorder salvat. Este singura subcomanda publica din grup; mutatiile raman admin si ephemeral. |
| `/future-release delete game:<nume>` | Admin, Ephemeral | Sterge un joc din lista future-release. |
| `/future-release start` | Admin, Ephemeral | Configureaza canalul, creeaza o generatie noua de activare si initializeaza baseline-ul fara val retroactiv. Jobul periodic emite o singura data pragurile 30/7/1 zile, aparitia/schimbarea/disparitia preorder-ului si trecerea post-release. |
| `/future-release stop` | Admin, Ephemeral | Opreste notificarile future-release si sterge canalul salvat pentru modul. |

Comenzile admin accepta implicit permisiunea Discord `Administrator`, apoi regula de rol dedicata comenzii daca ownerul a setat una prin `/set admin-command-access` cu optiunea `command:<comanda>`, apoi fallback-ul global configurat prin `/set admin-command-access` fara `command`, apoi codul global de acces introdus prin modal ephemeral. Pentru perechile `start`/`stop`, regula este comuna pe modul: `/start updates` acopera si `/stop updates`, iar `/start player-count` acopera si `/stop player-count`. Daca ownerul nu a configurat inca o regula de rol, rolurile simple nu dau acces admin; raman doar `Administrator` si codul global corect. Comenzile owner-only accepta ownerul serverului sau codul global corect. Codul global se tine in env/deployment secrets prin `BOT_GLOBAL_ACCESS_CODE_HASH`, cu `BOT_GLOBAL_ACCESS_CODE` doar ca fallback local. Pentru comenzile sensibile, daca `BOT_SENSITIVE_USER_IDS` este setat, userul trebuie sa fie si in acea lista privata de user ID-uri. ID-urile sunt folosite direct, nu numele rolurilor sau userilor. Clasificarea de securitate a fiecarei comenzi (publica, admin prin router, admin verificata in handler, owner-only, sensibila) este declarata intr-un singur manifest tipat (`commandAccessManifest`), din care guard-ul runtime isi deriva verificarile — nu mai exista liste manuale duplicate; teste de sincronizare verifica manifestul bidirectional contra slash definitions (inclusiv `setDefaultMemberPermissions`) si contra clasificarii afisate in catalogul `/help`.

## Monitorizare YouTube

Modulul YouTube urmareste canale publice pentru serverul Discord. Nu se autentifica in contul personal YouTube al administratorului si nu modifica abonamentele acelui cont. Botul rezolva canalul din link, handle sau channel ID si citeste feed-ul Atom oficial. La adaugare ignora continutul mai vechi de o luna, iar videoclipurile recente raman eligibile pentru prima activare.

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/youtube subscribe canal:<link|handle|id>` | Admin, Ephemeral | Adauga un canal YouTube in lista urmarita. Accepta un link `youtube.com`, un handle precum `@numeCanal` sau un channel ID care incepe cu `UC`. Videoclipurile mai vechi de o luna sunt memorate ca baseline; cele recente pot fi livrate la prima activare. |
| `/youtube unsubscribe canal:<canal>` | Admin, Autocomplete, Ephemeral | Scoate canalul ales din lista urmarita si elimina deduplicarea persistata pentru acel canal. Autocomplete-ul sugereaza numai canalele deja salvate pe server. |
| `/youtube list` | Admin, Ephemeral | Listeaza canalele urmarite, linkul fiecaruia, ultima verificare reusita si ultima eroare cunoscuta. |
| `/youtube notify channel channel:<canal>` | Admin, Ephemeral | Seteaza canalul Discord in care vor fi postate videoclipurile noi. Inainte de salvare verifica `View Channel`, `Send Messages` si `Embed Links`. |
| `/youtube notify on` | Admin, Ephemeral | Porneste postarile automate. Necesita cel putin un canal YouTube urmarit si un canal Discord configurat. |
| `/youtube notify off` | Admin, Ephemeral | Opreste postarile automate fara sa stearga lista canalelor YouTube sau filtrele. Dupa prima activare, videoclipurile aparute in pauza sunt memorate fara livrare, ca reactivarea sa nu produca un val retroactiv. |
| `/youtube notify status` | Admin, Ephemeral | Afiseaza daca postarile sunt active, canalul Discord, numarul de canale urmarite, filtrele curente, ultima verificare si numarul erorilor recente. |
| `/youtube filter shorts state:<on|off>` | Admin, Ephemeral | Cand este `on`, exclude videoclipurile marcate ca Shorts si clipurile cu durata de cel mult 60 de secunde. |
| `/youtube filter lives state:<on|off>` | Admin, Ephemeral | Cand este `on`, exclude livestream-urile detectate din metadatele paginii videoclipului. |
| `/youtube filter premieres state:<on|off>` | Admin, Ephemeral | Cand este `on`, exclude premierele programate. |
| `/youtube filter min-duration seconds:<numar>` | Admin, Ephemeral | Seteaza durata minima acceptata in secunde. `0` dezactiveaza limita. Daca limita este activa si durata nu poate fi confirmata, filtrul este fail-closed si videoclipul nu este postat. |
| `/youtube filter status` | Admin, Ephemeral | Afiseaza starea filtrelor Shorts, livestream, premiere si durata minima. |
| `/youtube add channel-route canal:<canal> discord:<#canal>` | Admin, Ephemeral | Adauga o ruta Discord speciala pentru canalul YouTube ales. Pot exista mai multe rute. Cat timp exista cel putin una, videoclipurile acelui canal sunt trimise numai pe rutele speciale, nu si pe canalul principal. |
| `/youtube remove channel-route canal:<canal> discord:<#canal|toate>` | Admin, Autocomplete, Ephemeral | Sterge o ruta sau toate rutele speciale ale canalului YouTube. Dupa stergerea ultimei rute, livrarea revine automat la canalul principal. |
| `/youtube channel-route list` | Admin, Ephemeral | Listeaza canalele YouTube care au rute speciale si toate destinatiile Discord aferente. |
| `/youtube add title-filter word:<valoare>` | Admin, Ephemeral | Adauga un cuvant sau o expresie in filtrul inclusiv. Cand lista nu este goala, titlul trebuie sa contina cel putin una dintre valori; compararea nu tine cont de litere mari sau mici. |
| `/youtube remove title-filter word:<valoare>` | Admin, Autocomplete, Ephemeral | Elimina o valoare din filtrul inclusiv. |
| `/youtube title-filter list` | Admin, Ephemeral | Listeaza toate valorile filtrului inclusiv. |
| `/youtube title-filter clear` | Admin, Ephemeral | Goleste filtrul inclusiv, astfel incat toate titlurile sa poata trece acest filtru. |
| `/youtube status` | Admin, Ephemeral | Afiseaza starea completa a modulului: notificari, canal Discord, canale urmarite, ultima verificare, filtre si erori recente. |
| `/youtube clear-errors` | Admin, Ephemeral | Curata istoricul local al erorilor YouTube dupa ce problema a fost investigata sau rezolvata. Nu modifica abonamentele si nu porneste/opreste notificarile. |

Pentru configurarea initiala: ruleaza `/youtube notify channel`, adauga unul sau mai multe canale cu `/youtube subscribe`, seteaza filtrele dorite si porneste postarile cu `/youtube notify on`. La prima activare sunt eligibile numai videoclipurile din ultima luna. Deduplicarea automata foloseste serverul, canalul YouTube si ID-ul videoclipului; schimbarea titlului sau a thumbnail-ului nu retrimite acelasi ID, iar un reupload cu ID nou este tratat ca videoclip nou. `/youtube status` este verificarea principala cand un videoclip nu apare.

## Filtru de jocuri pentru update-uri

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set add games joc:<key>` | Admin, Autocomplete, Ephemeral | Adauga un joc in lista explicita de jocuri active pentru server. |
| `/set remove games joc:<key>` | Admin, Autocomplete, Ephemeral | Scoate un joc din lista explicita de jocuri active pentru server. |
| `/set games reset` | Admin, Ephemeral | Reseteaza filtrul de jocuri. Dupa reset, toate jocurile configurate sunt active. |
| `/watchlist show` | Admin, Ephemeral | Afiseaza jocurile urmarite explicit. Daca lista este goala, serverul foloseste toate jocurile configurate. |
| `/add watchlist joc:<key>` | Admin, Autocomplete, Ephemeral | Adauga un joc in watchlist-ul serverului. |
| `/remove watchlist joc:<key>` | Admin, Autocomplete, Ephemeral | Scoate un joc din watchlist-ul serverului. |
| `/watchlist reset` | Admin, Ephemeral | Reseteaza watchlist-ul. Dupa reset, toate jocurile configurate sunt active. |
| `/watchlist coverage` | Admin, Ephemeral | Arata pentru fiecare joc din watchlist ce capabilitati sunt disponibile: update, pret, player-count, status, DLC si review-uri. Rezultatele sunt paginate. |
| `/game-alias add joc:<key> alias:<text>` | Admin, Autocomplete, Ephemeral | Adauga un alias local serverului pentru jocul ales si respinge aliasurile deja detinute de alt joc. |
| `/game-alias remove joc:<key> alias:<text>` | Admin, Ephemeral | Sterge aliasul local normalizat pentru jocul selectat. |
| `/game-alias list joc:<key>` | Admin, Ephemeral | Listeaza paginat aliasurile locale salvate pentru jocul selectat. |

## Roluri ping pentru notificari

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set role updates value:<role>` | Admin, Ephemeral | Seteaza rolul mentionat la notificarile de update-uri. Daca rolul lipseste, opreste ping-ul pentru update-uri. |
| `/set role discounts value:<role>` | Admin, Ephemeral | Seteaza rolul mentionat la notificarile de reduceri. Daca rolul lipseste, opreste ping-ul pentru reduceri. |

## Livrare interna a notificarilor

Outbox-ul ramane sistemul intern prin care botul tine minte notificarile care trebuie trimise pe Discord. Administrarea sa nu mai este expusa prin comenzi Discord.

Concepte utile pentru admini:

- `coada`: lista de notificari care asteapta sa fie trimise.
- `job`: o notificare concreta din coada, de exemplu un embed de update sau de reducere pentru un server.
- `drain`: procesul prin care botul ia joburi din coada si incearca sa le trimita pe Discord.
- `dead-letter`: zona unde ajung joburile care nu au putut fi trimise dupa incercarile normale sau care au expirat. Practic, este lista de livrari esuate care trebuie investigate.
- `replay`: reintroducerea unei livrari esuate din dead-letter inapoi in coada, dupa ce ai reparat cauza.
- `retry`: forteaza joburile care asteapta/reincearca mai tarziu sa fie incercate din nou imediat.
- `lock`: protectie ca sa nu ruleze doua drenari in acelasi timp si sa trimita aceeasi notificare de doua ori.
- `recovery-verify`: verificare suplimentara prin care botul incearca sa confirme ca o notificare trimisa exista in canal, folosind istoricul de mesaje.

## Update-uri, reduceri si cautari manuale

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/latest updates` | Public | Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache cand exista date valide, poate folosi ultimul snapshot salvat (cu banner) daca fetch-ul live esueaza temporar, si pagineaza rezultatele. |
| `/latest reduceri` | Public | Afiseaza cele mai bune reduceri curente care trec filtrele serverului. Foloseste cache si poate folosi ultimul snapshot salvat daca fetch-ul live esueaza temporar. |
| `/latest update joc:<name/key>` | Public, Autocomplete | Cauta ultimul update pentru un joc anume. Foloseste cache per joc si sugereaza o potrivire apropiata cand jocul nu este gasit. |
| `/latest pret joc:<name>` | Public, Autocomplete | Cauta pretul curent al unui joc pe Steam in valuta serverului si afiseaza detaliile de pret intr-un embed. |
| `/dlc joc:<name>` | Public, Autocomplete | Cauta DLC-urile disponibile pentru un joc pe Steam si le afiseaza paginat. |
| `/game overview joc:<name/key>` | Public, Autocomplete | Agrega ultimul update, cea mai buna oferta, scorul ofertei, player-count, statusul serverelor, DLC-urile si prezenta in watchlist. Sursele sunt izolate, astfel incat un esec partial nu anuleaza restul rezultatului. |
| `/status game joc:<name/key>` | Public, Autocomplete | Afiseaza starea online, mentenanta, degradata sau necunoscuta si momentul ultimei verificari. |
| `/status watchlist` | Public | Verifica independent jocurile compatibile din watchlist si pagineaza rezultatele, pastrand stare necunoscuta pentru sursele care esueaza. |
| `/review-trend game game:<name>` | Public, Autocomplete | Afiseaza trendul real din snapshot-uri Steam persistente: procent pozitiv, volum, delta fata de esantionul anterior si interpretare. Esantioanele sunt ordonate temporal si perioadele cu volum mic sunt marcate drept semnal slab, ca sa nu supraevalueze review-bombing-ul. |
| `/crossplay game game:<name>` | Public, Autocomplete | Verifica metadatele Steam pentru semnale de crossplay si cross-save. Cand Steam nu confirma informatia, raspunsul spune explicit ca nu este detectata in sursa curenta. |
| `/platforms game game:<name>` | Public, Autocomplete | Afiseaza platformele Steam detectate si magazinele externe gasite in sursele de reduceri pentru jocul cautat. |
| `/co-op game game:<name>` | Public, Autocomplete | Afiseaza modurile detectate in Steam pentru joc: single-player, online co-op, local/split-screen co-op, PvP sau MMO. |
| `/system requirements game game:<name>` | Public, Autocomplete | Afiseaza cerintele minime si recomandate returnate de Steam pentru joc. |
| `/game-size game game:<name>` | Public, Autocomplete | Afiseaza separat dimensiunea aproximativa de instalare si dimensiunea ultimului update. Instalarea vine din cerintele Steam, iar update-ul numai dintr-o valoare explicita KB/MB/GB/TB din feed-ul oficial Steam News; daca nu exista o cifra explicita, campul ramane indisponibil. |
| `/player-count game game:<name>` | Public, Autocomplete | Afiseaza valoarea curenta reala Steam, recordul observat si directia fata de esantionul anterior, folosind timpul efectiv al esantionului. Preferinta este pentru snapshot-ul periodic proaspat, cu fetch live la nevoie. |
| `/player-count trend joc:<name> period:<24h\|7d\|30d>` | Public, Autocomplete | Afiseaza minimul, maximul, media, schimbarea procentuala si un sparkline din istoricul periodic. |
| `/player-count milestone joc:<name>` | Public, Autocomplete | Afiseaza recordul istoric, data sa, valoarea curenta si diferenta pana la record. Un record nou detectat periodic poate trimite automat notificare pe canalele abonate. |
| `/player-count gainers period:<24h\|7d\|30d>` | Public | Compara prima si ultima valoare disponibila si afiseaza topul cresterilor procentuale, izolat per joc. |
| `/player-count peak-time joc:<name> period:<24h\|7d\|30d>` | Public, Autocomplete | Grupeaza istoricul pe ore si afiseaza intervalele cu cea mai mare medie in fusul orar al serverului sau UTC. |
| `/top active games` | Public | Afiseaza topul global al jocurilor cunoscute de bot care au Steam appId, sortat dupa player-count Steam. Nu este limitat de watchlist-ul sau filtrul de jocuri al serverului. Citeste intai snapshot-urile periodice salvate de cron (proaspete sub 15 minute), deci acopera toate jocurile candidate fara fanout de retea la comanda; doar jocurile fara snapshot proaspat sunt verificate live (concurenta marginita, maxim 25, cu continuare la esec per joc), iar topul partial si jocurile omise sunt mentionate explicit in embed. |
| `/sources status` | Admin, Ephemeral | Afiseaza starea ultimelor snapshot-uri persistate pentru sursele externe: Steam/Epic, feed-urile de update pe joc, erori recente si varsta ultimei verificari cunoscute, plus un sumar de sanatate al surselor din starea circuit breaker-elor (sanatoase / degradate / in cooldown / schema-drift) cu lista surselor cu probleme. Nu face fetch live; arata ce stie botul din ultima rulare salvata. |

## Raportare si sanatate

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/report bug tip:<tip> joc:<name>` | Public, Ephemeral | Deschide un modal cu descriere obligatorie, salveaza bug-ul separat si blocheaza duplicatele aceluiasi tip, joc si text, returnand ID-ul existent. |
| `/report complaint target:<membru>` | Public, Ephemeral | Deschide un modal pentru reclamarea unui membru. Blocheaza auto-raportarea, botii si duplicatele si aplica cooldown. |
| `/report list bugs` | Admin runtime, Ephemeral | Listeaza paginat numai rapoartele de bug, cu ID-urile necesare stergerii. |
| `/report list users` | Admin runtime, Ephemeral | Listeaza paginat numai reclamatiile impotriva membrilor. |
| `/report remove bug id:<id>` | Admin runtime, Ephemeral | Sterge ID-ul exclusiv din colectia rapoartelor de bug. |
| `/report remove user id:<id>` | Admin runtime, Ephemeral | Sterge ID-ul exclusiv din colectia reclamatiilor. |
| `/health` | Admin, Ephemeral | Afiseaza starea botului: conexiune Discord, MongoDB, cache-uri, uptime si detalii despre endpoint-ul de metrics. |

## Securitate si moderare

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/timeout utilizator:<membru> durata:<durata> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Aplica un timeout de la 1 secunda pana la 28 de zile, cu verificare de ierarhie. Motivul poate fi text fara linkuri sau un atasament incarcat direct. Daca persistenta esueaza, timeout-ul Discord este retras. |
| `/remove-timeout utilizator:<membru>` | Admin, Ephemeral, Guild-only | Elimina timeout-ul Discord si inregistrarea persistata; daca una dintre operatii esueaza, raspunsul declara exact starea ramasa pentru reconciliere. |
| `/timeout-list` | Public, Guild-only | Reconciliaza starea persistata cu timeout-ul Discord, elimina inregistrarile expirate si afiseaza paginat numai restrictiile active, cu moderator si expirare. |
| `/mute utilizator:<membru> durata:<durata> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Aplica un mute persistent cu aceleasi verificari, validari si rollback ca timeout-ul. |
| `/unmute utilizator:<membru>` | Admin, Ephemeral, Guild-only | Elimina mute-ul activ si raporteaza explicit orice stare partiala care necesita interventie. |
| `/mute-list` | Public, Guild-only | Reconciliaza rolul Discord cu persistenta si afiseaza numai mute-urile active. |
| `/kick utilizator:<membru> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Elimina un membru, respectand ierarhia Discord si permisiunile botului. Linkurile in motiv sunt refuzate; dovezile trebuie incarcate direct. |
| `/ban utilizator:<membru> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Baneaza un membru, cu aceeasi politica de motiv si atasament. |
| `/unban utilizator:<membru> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Debaneaza utilizatorul prin API-ul `guild.bans.remove`. |
| `/set warn-channel canal:<canal>` | Admin, Ephemeral, Guild-only | Configureaza canalul dedicat in care sunt publicate avertismentele si dovezile directe. Botul valideaza View Channel, Send Messages si Embed Links. |
| `/warn utilizator:<membru> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Publica avertismentul in canalul dedicat si persista numai metadatele necesare listei, nu motivul sau continutul sensibil. Daca publicarea esueaza, este retrasa exact inregistrarea creata de comanda curenta. |
| `/remove-warn utilizator:<membru>` | Admin, Guild-only | Elimina cel mai recent avertisment al unui membru. |
| `/warn-list` | Public, Guild-only | Afiseaza sumarul avertismentelor grupat pe utilizator: o singura intrare per utilizator, cu totalul de warn-uri active, sortat descrescator dupa numar, si data ultimului warn. |
| `/warn-ban-limit numar:<1-100>` | Admin, Ephemeral, Guild-only | Configureaza limita care declanseaza ban automat si afiseaza limita anterioara impreuna cu cea noua. |
| `/lock-channel canal:<canal> motiv:<text> atasament:<fisier>` | Admin, Ephemeral, Guild-only | Verifica permisiunile botului, blocheaza mesajele si salveaza starea anterioara exacta `allow`, `deny` sau `inherit`. Update-ul Discord si persistenta au rollback reciproc. |
| `/unlock-channel canal:<canal>` | Admin, Ephemeral, Guild-only | Verifica permisiunile botului si restaureaza exact starea Send Messages de dinainte. Canalele sterse sunt eliminate automat din evidenta. |
| `/purge` | Admin, Ephemeral, Guild-only | Sterge pana la 50 de mesaje recente si explica limita Discord care exclude mesajele mai vechi de 14 zile. |
| `/purge-amount numar:<1-100>` | Admin, Ephemeral, Guild-only | Sterge numarul indicat de mesaje recente si raporteaza separat cate au fost sterse si cate au fost omise. |
| `/set new-account-alert-channel canal:<canal>` | Admin, Ephemeral, Guild-only | Configureaza canalul pentru alertele conturilor Discord recente si valideaza permisiunile botului. |
| `/start new-account-alerts` | Admin, Ephemeral, Guild-only | Activeaza alertele pentru conturi create in ultimele trei luni calendaristice. Claim-ul persistent este comun scanarii initiale si evenimentului live, astfel incat acelasi membru nu produce doua alerte; la esecul livrarii claim-ul este eliberat pentru retry. |
| `/stop new-account-alerts` | Admin, Guild-only | Dezactiveaza alertele conturilor noi si pastreaza canalul. |
| `/set threat-alert-channel canal:<canal>` | Admin, Ephemeral, Guild-only | Configureaza canalul pentru alerte de continut suspect si valideaza permisiunile botului. |
| `/start threat-protection` | Admin, Ephemeral, Guild-only | Inspecteaza textul, redirecturile, linkurile, atasamentele si arhivele ZIP/TAR/GZIP recursiv, cu limite de adancime, numar si bytes. Documentele Office/PDF sunt analizate pasiv pentru macro-uri si actiuni automate. `confirmed` este acceptat numai daca motorul extern confirma SHA-256 al octetilor descarcati si este singurul verdict sters automat; esecul stergerii nu blocheaza alerta sau auditul. Mesajele boturilor sunt inspectate si dupa join. |
| `/stop threat-protection` | Admin, Guild-only | Dezactiveaza detectarea si pastraza canalul configurat. |
| `/set bot-add-alert-channel canal:<canal>` | Admin, Ephemeral, Guild-only | Configureaza canalul pentru solicitarile si alertele privind adaugarea botilor si valideaza permisiunile botului. |
| `/set permission-request-channel canal:<canal>` | Admin, Ephemeral, Guild-only | Configureaza canalul unic pentru toate cererile de aprobare de securitate si pentru deciziile ownerului, cu validarea permisiunilor View Channel, Send Messages si Embed Links. Preia si fluxul de aprobare pentru adaugarea botilor: la migrare, valoarea din `/set bot-add-alert-channel` este copiata aici. |
| `/start bot-add-protection` | Admin, Ephemeral, Guild-only | Leaga aprobarea de botul exact si solicitantul rezolvat prin Audit Log cu retry. Aprobarea owner este one-time, expira si se consuma atomic; botii fara aprobare sunt eliminati, iar solicitantul primeste rezultatul localizat. Botii admisi intra intr-o fereastra persistenta de observatie de sapte zile pentru schimbari periculoase. |
| `/stop bot-add-protection` | Admin, Ephemeral, Guild-only | Dezactiveaza protectia si anuleaza atomic toate solicitarile/aprobarile neexpirate, astfel incat nicio aprobare veche sa nu ramana valida. |
| `/bot-add-request` | Admin, Ephemeral, Guild-only | Creeaza o solicitare pending pentru perechea bot plus solicitant, cu expirare automata si aprobarea sau respingerea ownerului prin butoane. |
| `/bot-add-permissions` | Admin, Ephemeral, Guild-only | Listeaza paginat toate solicitarile cu status, bot, solicitant, owner, creare, raspuns, expirare si consumare. |
