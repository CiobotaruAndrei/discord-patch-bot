# Comenzi Functionalitate

Acest fisier documenteaza comenzile slash expuse de bot si rolul fiecareia in comportamentul curent al repo-ului.

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
| `/help command:<comanda>` | Afiseaza ephemeral explicatia detaliata pentru o comanda exacta. Optiunea `command` are autocomplete cu comenzile existente, de exemplu `/set games add`, `/outbox deadletters` sau `/latest pret`. |

## Pauze temporare pentru comenzi

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/snooze command:<comanda> durata:<timp>` | Admin, Ephemeral | Pune temporar pe pauza o comanda existenta a botului pentru server. Optiunea `command` are autocomplete ca `/help command`, iar `durata` accepta valori precum `30m`, `2h` sau `1d`. Nu poate opri `/snooze` sau `/unsnooze`, ca adminii sa poata gestiona mereu pauzele. |
| `/unsnooze command:<comanda>` | Admin, Ephemeral | Scoate pauza temporara de pe comanda aleasa inainte sa expire automat. Foloseste acelasi autocomplete pe comenzile existente. |

## Notificari automate

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/start updates` | Admin | Porneste notificarile automate de update-uri in canalul curent. Verifica permisiunile canalului, salveaza canalul in setarile serverului si face baseline initial ca sa nu trimita update-uri vechi. |
| `/start reduceri` | Admin | Porneste alertele automate de reduceri in canalul curent. Verifica permisiunile canalului, salveaza canalul si face baseline initial pentru ofertele deja vazute. |
| `/stop updates` | Admin | Opreste notificarile automate de update-uri pentru server si curata coada/starea aferenta. |
| `/stop reduceri` | Admin | Opreste alertele automate de reduceri pentru server si curata coada/starea aferenta. |

## Setari server

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set mode value:<compact|detailed>` | Admin | Alege modul de afisare al embed-urilor. `compact` afiseaza mai scurt, `detailed` include mai multe detalii. |
| `/set mindiscount value:<0-100>` | Admin | Seteaza procentul minim de reducere acceptat pentru alertele de reduceri. Reseteaza coada de reduceri in asteptare. |
| `/set maxprice value:<0-10000>` | Admin | Seteaza pretul maxim absolut pentru reduceri. Valoarea `0` dezactiveaza limita. Reseteaza coada de reduceri in asteptare. |
| `/set free value:<on|off>` | Admin | Activeaza sau dezactiveaza afisarea jocurilor gratuite in alertele de reduceri. Reseteaza coada de reduceri in asteptare. |
| `/set paid value:<on|off>` | Admin | Activeaza sau dezactiveaza afisarea ofertelor platite in alertele de reduceri. Reseteaza coada de reduceri in asteptare. |
| `/set currency value:<currency>` | Admin | Seteaza valuta folosita pentru preturi si reduceri. Optiunile vin din registrul de valute suportate de bot. Reseteaza coada de reduceri in asteptare. |
| `/set stores value:<steam,epic|reset>` | Admin | Filtreaza reducerile dupa magazinele permise. `reset` revine la filtrul implicit. Reseteaza coada de reduceri in asteptare. |
| `/set outbox-recovery-verify value:<on|off>` | Admin | Activeaza sau dezactiveaza verificarea de recovery outbox pentru server. Cand este activata, botul avertizeaza daca ii lipseste `Read Message History` pe canalele configurate. |
| `/config` | Admin, Ephemeral | Afiseaza setarile curente ale serverului intr-un singur embed: mod, reducere minima, pret maxim, filtre free/paid, valuta, magazine, jocuri active, roluri de ping, canale pentru update-uri/reduceri/YouTube, canalul administrativ, alertele de pret si numarul canalelor YouTube urmarite. |
| `/reset-config confirm:true` | Admin, Ephemeral | Reseteaza toate setarile botului pentru server: abonari, canale, roluri, filtre, watchlist, snooze-uri, alerte de pret, configurarea YouTube si canalul administrativ. Confirmarea trebuie sa fie explicit `true`. Istoricul rapoartelor si notificarilor nu este sters. |

## Alerte de pret

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/price-alert add joc:<key> price:<0.01-10000> currency:<valuta>` | Admin, Autocomplete, Ephemeral | Adauga sau actualizeaza alerta pentru perechea joc+valuta. Botul cauta oferta jocului in ciclul de reduceri si trimite un embed cand pretul ajunge la sau sub prag. Necesita un canal activ prin `/start reduceri`. |
| `/price-alert remove joc:<key>` | Admin, Autocomplete, Ephemeral | Sterge toate alertele acelui joc, indiferent de valuta. Autocomplete-ul sugereaza numai jocurile care au alerte configurate. |
| `/price-alert list` | Admin, Ephemeral | Afiseaza fiecare alerta, pragul, valuta, ultimul pret observat si daca alerta este armata sau deja declansata. |

O alerta declansata nu este retrimisa la fiecare ciclu. Ea ramane marcata ca declansata cat timp pretul este sub prag si se rearmeaza automat cand pretul urca din nou peste prag. Claim-ul este atomic in Mongo, astfel incat doua instante ale botului nu pot trimite aceeasi alerta simultan.

## Alerte administrative

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/admin-alerts set channel:<canal>` | Admin, Ephemeral | Configureaza canalul pentru embed-uri administrative. Inainte de salvare verifica permisiunile `Send Messages` si `Embed Links`. |
| `/admin-alerts off` | Admin, Ephemeral | Opreste alertele administrative Discord pentru server. Webhook-ul global, daca este configurat prin env, ramane independent. |

Canalul administrativ primeste alerte operationale cu severitate, cauza, explicatie si actiune recomandata. Rapoartele trimise prin `/report submit` sunt directionate numai catre canalul serverului respectiv. Alertele globale despre cron, surse, outbox sau proces sunt distribuite canalelor administrative configurate. Daca un canal este sters sau botul pierde permanent accesul, configurarea acelui canal este dezactivata automat.

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
| `/youtube message-template set text:<text>` | Admin, Ephemeral | Seteaza textul atasat notificarilor. Variabilele acceptate sunt `{channel}`, `{title}` si `{url}`. Alte variabile sunt respinse, iar mentiunile Discord sunt dezactivate la trimitere. |
| `/youtube message-template reset` | Admin, Ephemeral | Revine la sablonul implicit `Videoclip nou de la {channel}: {title}\n{url}`. |
| `/youtube message-template status` | Admin, Ephemeral | Afiseaza sablonul folosit in prezent. |
| `/youtube channel-route add canal:<canal> discord:<#canal>` | Admin, Ephemeral | Adauga o ruta Discord speciala pentru canalul YouTube ales. Pot exista mai multe rute. Cat timp exista cel putin una, videoclipurile acelui canal sunt trimise numai pe rutele speciale, nu si pe canalul principal. |
| `/youtube channel-route remove canal:<canal> discord:<#canal|toate>` | Admin, Autocomplete, Ephemeral | Sterge o ruta sau toate rutele speciale ale canalului YouTube. Dupa stergerea ultimei rute, livrarea revine automat la canalul principal. |
| `/youtube channel-route list` | Admin, Ephemeral | Listeaza canalele YouTube care au rute speciale si toate destinatiile Discord aferente. |
| `/youtube title-filter add word:<valoare>` | Admin, Ephemeral | Adauga un cuvant sau o expresie in filtrul inclusiv. Cand lista nu este goala, titlul trebuie sa contina cel putin una dintre valori; compararea nu tine cont de litere mari sau mici. |
| `/youtube title-filter remove word:<valoare>` | Admin, Autocomplete, Ephemeral | Elimina o valoare din filtrul inclusiv. |
| `/youtube title-filter list` | Admin, Ephemeral | Listeaza toate valorile filtrului inclusiv. |
| `/youtube title-filter clear` | Admin, Ephemeral | Goleste filtrul inclusiv, astfel incat toate titlurile sa poata trece acest filtru. |
| `/youtube videos show canal:<canal|toate>` | Admin, Autocomplete, Ephemeral | Posteaza manual videoclipurile din ultima luna pentru canalul ales sau pentru toate canalele urmarite. Aplica aceleasi filtre, sablon si rute ca fluxul automat, dar nu marcheaza videoclipurile ca vazute. Pana la 5 rezultate sunt trimise imediat; restul sunt impartite in loturi de 5, cu 10 minute intre loturi. |
| `/youtube status` | Admin, Ephemeral | Afiseaza starea completa a modulului: notificari, canal Discord, canale urmarite, ultima verificare, filtre si erori recente. |
| `/youtube errors` | Admin, Ephemeral | Listeaza ultimele erori de rezolvare canal, citire feed, citire metadate sau livrare Discord. Lista este plafonata, ca documentul serverului sa nu creasca nelimitat. |
| `/youtube permissions` | Admin, Ephemeral | Verifica permisiunile botului pe canalul Discord configurat pentru YouTube si indica exact ce lipseste. |
| `/youtube clear-errors` | Admin, Ephemeral | Curata istoricul local al erorilor YouTube dupa ce problema a fost investigata sau rezolvata. Nu modifica abonamentele si nu porneste/opreste notificarile. |

Pentru configurarea initiala: ruleaza `/youtube notify channel`, adauga unul sau mai multe canale cu `/youtube subscribe`, seteaza filtrele dorite si porneste postarile cu `/youtube notify on`. La prima activare sunt eligibile numai videoclipurile din ultima luna. Pentru 6 sau mai multe rezultate, botul trimite loturi de cate 5 si asteapta 10 minute intre ele. Deduplicarea automata foloseste serverul, canalul YouTube si ID-ul videoclipului; schimbarea titlului sau a thumbnail-ului nu retrimite acelasi ID, iar un reupload cu ID nou este tratat ca videoclip nou. Comenzile `/youtube status`, `/youtube errors` si `/youtube permissions` sunt primele verificari cand un videoclip nu apare.

## Filtru de jocuri pentru update-uri

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set games add joc:<key>` | Admin, Autocomplete | Adauga un joc in lista explicita de jocuri active pentru server. |
| `/set games remove joc:<key>` | Admin, Autocomplete | Scoate un joc din lista explicita de jocuri active pentru server. |
| `/set games reset` | Admin | Reseteaza filtrul de jocuri. Dupa reset, toate jocurile configurate sunt active. |
| `/watchlist show` | Admin | Afiseaza jocurile urmarite explicit. Daca lista este goala, serverul foloseste toate jocurile configurate. |
| `/watchlist add joc:<key>` | Admin, Autocomplete | Adauga un joc in watchlist-ul serverului. |
| `/watchlist remove joc:<key>` | Admin, Autocomplete | Scoate un joc din watchlist-ul serverului. |
| `/watchlist reset` | Admin | Reseteaza watchlist-ul. Dupa reset, toate jocurile configurate sunt active. |

## Roluri ping pentru notificari

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set role updates value:<role>` | Admin | Seteaza rolul mentionat la notificarile de update-uri. Daca rolul lipseste, opreste ping-ul pentru update-uri. |
| `/set role discounts value:<role>` | Admin | Seteaza rolul mentionat la notificarile de reduceri. Daca rolul lipseste, opreste ping-ul pentru reduceri. |

## Operare outbox

Outbox-ul este sistemul intern prin care botul tine minte notificarile care trebuie trimise pe Discord. In loc sa trimita totul direct si sa piarda mesajele daca Discord/Mongo/canalul pica temporar, botul pune livrarile intr-o coada si le proceseaza controlat.

Concepte utile pentru admini:

- `coada`: lista de notificari care asteapta sa fie trimise.
- `job`: o notificare concreta din coada, de exemplu un embed de update sau de reducere pentru un server.
- `drain`: procesul prin care botul ia joburi din coada si incearca sa le trimita pe Discord.
- `dead-letter`: zona unde ajung joburile care nu au putut fi trimise dupa incercarile normale sau care au expirat. Practic, este lista de livrari esuate care trebuie investigate.
- `replay`: reintroducerea unei livrari esuate din dead-letter inapoi in coada, dupa ce ai reparat cauza.
- `retry`: forteaza joburile care asteapta/reincearca mai tarziu sa fie incercate din nou imediat.
- `lock`: protectie ca sa nu ruleze doua drenari in acelasi timp si sa trimita aceeasi notificare de doua ori.
- `recovery-verify`: verificare suplimentara prin care botul incearca sa confirme ca o notificare trimisa exista in canal, folosind istoricul de mesaje.

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/outbox status` | Admin | Arata daca sistemul de livrare este pornit sau pus pe pauza, cate notificari asteapta in coada, cate livrari au ajuns in dead-letter si daca recovery-verify este activ. Este prima comanda de rulat cand notificarile nu mai apar sau par intarziate. |
| `/outbox deadletters` | Admin | Listeaza ultimele livrari esuate pentru server. O folosesti ca sa vezi ce notificari nu au ajuns pe canal si motivul aproximativ: canal lipsa, permisiuni lipsa, mesaj imposibil de trimis, job expirat sau alta eroare. |
| `/outbox clear-deadletters` | Admin | Curata lista de livrari esuate dupa ce ai verificat cauza si nu mai ai nevoie de istoric. Nu repara problema si nu retrimite mesajele; doar sterge raportarea dead-letter pentru server. |
| `/outbox replay-deadletters` | Admin | Reintroduce in coada livrarile esuate care inca au payload salvat si pot fi retrimise. Ruleaza asta dupa ce ai reparat cauza, de exemplu dupa ce ai dat botului permisiuni pe canal sau ai refacut canalul configurat. |
| `/outbox retry` | Admin | Pune joburile existente ale serverului la incercare imediata. Este util cand problema a fost temporara, de exemplu Discord a raspuns greu sau botul a fost rate-limited, iar mesajele sunt inca in coada, nu in dead-letter. |
| `/outbox drain-now` | Admin | Porneste manual procesarea cozii acum, fara sa astepti urmatorul ciclu automat. Comanda ruleaza doar daca drenarea globala nu este pe pauza si nu exista deja un drain activ, ca sa evite trimiterea peste o interventie de mentenanta sau dublarea mesajelor. Daca outbox-ul este pe pauza, foloseste intai `/outbox resume`. |
| `/outbox pause` | Admin | Opreste temporar procesarea globala a cozii. Joburile pot ramane/aduna in coada, dar botul nu le mai trimite pana la resume. Este util la mentenanta, probleme de permisiuni sau risc de spam. |
| `/outbox resume` | Admin | Reporneste procesarea globala a cozii dupa o pauza. Dupa resume, botul poate continua sa trimita joburile care asteptau. |
| `/outbox permissions` | Admin | Verifica daca botul are permisiunile necesare pe canalele configurate pentru update-uri, reduceri si YouTube: sa vada canalul, sa trimita mesaje, sa trimita embed-uri si, unde e cazul, sa citeasca istoricul pentru recovery-verify. |
| `/outbox recovery-verify status` | Admin | Arata daca verificarea suplimentara de recovery este activa pentru server si/sau global. Daca este activa, botul are nevoie de permisiunea `Read Message History` pe canal ca sa poata confirma livrarile dupa recovery. |

## Update-uri, reduceri si cautari manuale

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/latest updates` | Public | Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache cand exista date valide, poate folosi ultimul snapshot salvat (cu banner) daca fetch-ul live esueaza temporar, si pagineaza rezultatele. |
| `/latest reduceri` | Public | Afiseaza cele mai bune reduceri curente care trec filtrele serverului. Foloseste cache si poate folosi ultimul snapshot salvat daca fetch-ul live esueaza temporar. |
| `/latest update joc:<name/key>` | Public, Autocomplete | Cauta ultimul update pentru un joc anume. Foloseste cache per joc si sugereaza o potrivire apropiata cand jocul nu este gasit. |
| `/latest pret joc:<name>` | Public, Autocomplete | Cauta pretul curent al unui joc pe Steam in valuta serverului si afiseaza detaliile de pret intr-un embed. |
| `/dlc joc:<name>` | Public, Autocomplete | Cauta DLC-urile disponibile pentru un joc pe Steam si le afiseaza paginat. |
| `/status joc:<name/key>` | Public, Autocomplete | Verifica statusul/serverele pentru jocul cerut si intoarce un embed de stare. |
| `/sources status` | Admin, Ephemeral | Afiseaza starea ultimelor snapshot-uri persistate pentru sursele externe: Steam/Epic, feed-urile de update pe joc, erori recente si varsta ultimei verificari cunoscute. Nu face fetch live; arata ce stie botul din ultima rulare salvata. |

## Istoric, raportare si sanatate

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/history tip:<updates|reduceri|youtube> numar:<1-25>` | Public, Ephemeral | Afiseaza istoricul notificarilor trimise pe server. `tip` este optional si poate filtra dupa update-uri, reduceri sau YouTube; `numar` este optional, implicit 10 si maxim 25. |
| `/report submit tip:<tip> detalii:<text> joc:<name>` | Public, Ephemeral | Trimite un raport despre o problema observata: update gresit, duplicat, joc/sursa lipsa, sursa stricata sau altceva. Salveaza raportul si trimite alerta administrativa. |
| `/report list numar:<1-25>` | Admin runtime, Ephemeral | Listeaza ultimele rapoarte trimise pe server, cu ID, tip, joc, detalii scurte si status rezolvat/nerezolvat. Este pentru administratori, chiar daca top-level-ul `/report` ramane public ca sa permita `/report submit`. |
| `/report resolve id:<id>` | Admin runtime, Ephemeral | Marcheaza un raport existent ca rezolvat. ID-ul este cel afisat de `/report list`; daca ID-ul nu exista pe server sau are format invalid, botul raspunde explicit fara sa modifice date. |
| `/health` | Admin, Ephemeral | Afiseaza starea botului: conexiune Discord, MongoDB, cache-uri, uptime si detalii despre endpoint-ul de metrics. |

## Tipuri acceptate de `/report submit`

| Valoare | Semnificatie |
| --- | --- |
| `update-gresit` | Update gresit sau inexact. |
| `duplicat` | Notificare duplicata. |
| `joc-lipsa` | Joc sau sursa lipsa. |
| `sursa-stricata` | Sursa nu mai trimite update-uri sau nu mai poate fi parsata corect. |
| `altceva` | Orice alta problema care nu se incadreaza in tipurile de mai sus. |
