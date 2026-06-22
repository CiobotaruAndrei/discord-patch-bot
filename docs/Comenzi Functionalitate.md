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

## Filtru de jocuri pentru update-uri

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/set games add joc:<key>` | Admin, Autocomplete | Adauga un joc in lista explicita de jocuri active pentru server. |
| `/set games remove joc:<key>` | Admin, Autocomplete | Scoate un joc din lista explicita de jocuri active pentru server. |
| `/set games reset` | Admin | Reseteaza filtrul de jocuri. Dupa reset, toate jocurile configurate sunt active. |
| `/set games list` | Admin | Afiseaza jocurile active explicit. Daca lista este goala, serverul foloseste toate jocurile configurate. |

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
| `/outbox permissions` | Admin | Verifica daca botul are permisiunile necesare pe canalele configurate pentru update-uri si reduceri: sa vada canalul, sa trimita mesaje, sa trimita embed-uri si, unde e cazul, sa citeasca istoricul pentru recovery-verify. |
| `/outbox recovery-verify status` | Admin | Arata daca verificarea suplimentara de recovery este activa pentru server si/sau global. Daca este activa, botul are nevoie de permisiunea `Read Message History` pe canal ca sa poata confirma livrarile dupa recovery. |

## Update-uri, reduceri si cautari manuale

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/latest updates` | Public | Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache cand exista date valide, poate folosi ultimul snapshot salvat daca fetch-ul live esueaza temporar si pagineaza rezultatele. |
| `/latest reduceri` | Public | Afiseaza cele mai bune reduceri curente care trec filtrele serverului. Foloseste cache si poate folosi ultimul snapshot salvat daca fetch-ul live esueaza temporar. |
| `/latest update joc:<name/key>` | Public, Autocomplete | Cauta ultimul update pentru un joc anume. Foloseste cache per joc si sugereaza o potrivire apropiata cand jocul nu este gasit. |
| `/latest pret joc:<name>` | Public, Autocomplete | Cauta pretul curent al unui joc pe Steam in valuta serverului si afiseaza detaliile de pret intr-un embed. |
| `/dlc joc:<name>` | Public, Autocomplete | Cauta DLC-urile disponibile pentru un joc pe Steam si le afiseaza paginat. |
| `/status joc:<name/key>` | Public, Autocomplete | Verifica statusul/serverele pentru jocul cerut si intoarce un embed de stare. |

## Istoric, raportare si sanatate

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/history tip:<updates|reduceri> numar:<1-25>` | Public, Ephemeral | Afiseaza istoricul notificarilor trimise pe server. `tip` este optional si poate filtra dupa update-uri sau reduceri; `numar` este optional, implicit 10 si maxim 25. |
| `/report tip:<tip> detalii:<text> joc:<name>` | Public, Ephemeral | Trimite un raport despre o problema observata: update gresit, duplicat, joc/sursa lipsa, sursa stricata sau altceva. Salveaza raportul si trimite alerta administrativa. |
| `/health` | Admin, Ephemeral | Afiseaza starea botului: conexiune Discord, MongoDB, cache-uri, uptime si detalii despre endpoint-ul de metrics. |

## Tipuri acceptate de `/report`

| Valoare | Semnificatie |
| --- | --- |
| `update-gresit` | Update gresit sau inexact. |
| `duplicat` | Notificare duplicata. |
| `joc-lipsa` | Joc sau sursa lipsa. |
| `sursa-stricata` | Sursa nu mai trimite update-uri sau nu mai poate fi parsata corect. |
| `altceva` | Orice alta problema care nu se incadreaza in tipurile de mai sus. |
