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

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/outbox status` | Admin | Afiseaza starea outbox-ului: activ/pauzat, joburi in coada, dead-letter count si recovery-verify. |
| `/outbox deadletters` | Admin | Listeaza ultimele livrari ajunse in dead-letter pentru server. |
| `/outbox clear-deadletters` | Admin | Goleste dead-letter-ele serverului dupa investigare sau replay. |
| `/outbox replay-deadletters` | Admin | Reintroduce in coada livrarile dead-letter care au payload replayable. |
| `/outbox retry` | Admin | Reprogrameaza joburile din coada ale serverului pentru livrare imediata. |
| `/outbox drain-now` | Admin | Forteaza o drenare imediata a outbox-ului daca lock-ul de drain este liber. |
| `/outbox pause` | Admin | Pune pe pauza drenarea outbox-ului la nivel global. |
| `/outbox resume` | Admin | Reia drenarea outbox-ului la nivel global. |
| `/outbox permissions` | Admin | Auditeaza permisiunile botului pe canalele configurate pentru update-uri si reduceri. |
| `/outbox recovery-verify status` | Admin | Afiseaza statusul recovery-verify pentru server si pentru configuratia globala. |

## Update-uri, reduceri si cautari manuale

| Comanda | Permisiuni | Ce face |
| --- | --- | --- |
| `/latest updates` | Public | Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache cand exista date valide si pagineaza rezultatele. |
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
