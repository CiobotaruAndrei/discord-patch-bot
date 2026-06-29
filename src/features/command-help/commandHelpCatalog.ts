"use strict";

type AutocompleteChoice = { name: string; value: string };
type CommandHelpChoiceOptions = { excludeCommands?: readonly string[] };

export type CommandHelpEntry = {
  command: string;
  permissions: string;
  description: string;
  example: string;
  notes?: readonly string[];
  aliases?: readonly string[];
};

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LEN = 100;

export const COMMAND_HELP_ENTRIES: readonly CommandHelpEntry[] = [
  { command: "/ping", permissions: "Public", description: "Verifica rapid daca botul raspunde la Discord.", example: "/ping" },
  { command: "/games", permissions: "Public", description: "Listeaza jocurile cunoscute de bot si cheile/poreclele pe care le poti folosi in comenzile cu joc.", example: "/games" },
  { command: "/help", permissions: "Public", description: "Afiseaza meniul general de ajutor. Daca alegi o comanda in optiunea command, primesti explicatia detaliata pentru comanda aceea.", example: "/help command:/set games add" },
  { command: "/config", permissions: "Admin, Ephemeral", description: "Afiseaza intr-un singur loc setarile curente ale serverului: mode, filtre de reduceri, valuta, store-uri, jocuri active, roluri si canale.", example: "/config" },
  { command: "/backup add", permissions: "Admin, Ephemeral", description: "Salveaza configuratia curenta a botului pentru server intr-un backup numit. Backup-ul include canale, roluri, filtre, watchlist, snooze-uri, alerte de pret si configurarea YouTube.", example: "/backup add name:inainte-youtube" },
  { command: "/backup list", permissions: "Admin, Ephemeral", description: "Afiseaza backup-urile salvate pentru server si cine le-a creat.", example: "/backup list" },
  { command: "/backup preview", permissions: "Admin, Ephemeral", description: "Arata ce setari, canale si roluri vor fi restaurate daca incarci backup-ul ales.", example: "/backup preview name:inainte-youtube" },
  { command: "/backup load", permissions: "Admin, Ephemeral", description: "Incarca un backup salvat si restaureaza configuratia botului pentru server. Cere confirmare explicita.", example: "/backup load name:inainte-youtube confirm:true" },
  { command: "/backup delete", permissions: "Admin, Ephemeral", description: "Sterge un backup salvat. Cere confirmare explicita ca sa nu fie sters accidental.", example: "/backup delete name:inainte-youtube confirm:true" },
  { command: "/bot-log", permissions: "Admin, Ephemeral", description: "Afiseaza ultimele comenzi admin executate pe server, cu user, comanda, data si rezultat.", example: "/bot-log numar:10" },
  { command: "/server-log", permissions: "Admin, Ephemeral", description: "Afiseaza ultimele schimbari importante salvate pentru server, de exemplu restaurari de backup sau alte actiuni administrative persistate.", example: "/server-log numar:10" },
  { command: "/reset-config", permissions: "Admin, Ephemeral", description: "Reseteaza toate setarile botului pentru server la valorile implicite. Istoricul rapoartelor si al notificarilor ramane pastrat.", example: "/reset-config confirm:true", notes: ["Resetarea ruleaza numai cand confirm este true."] },
  { command: "/admin-alerts set", permissions: "Admin, Ephemeral", description: "Seteaza canalul in care botul trimite alerte administrative despre erori operationale, dead-letter, permisiuni si rapoarte noi.", example: "/admin-alerts set channel:#bot-logs" },
  { command: "/admin-alerts off", permissions: "Admin, Ephemeral", description: "Opreste livrarea alertelor administrative in Discord pentru server.", example: "/admin-alerts off" },
  { command: "/price-alert add", permissions: "Admin, Ephemeral", description: "Adauga sau actualizeaza o alerta care se declanseaza cand jocul ajunge la sau sub pragul ales, in valuta aleasa.", example: "/price-alert add joc:elden-ring price:30 currency:EUR", notes: ["Alerta foloseste canalul configurat prin /start reduceri si se rearmeaza dupa ce pretul urca din nou peste prag."] },
  { command: "/price-alert remove", permissions: "Admin, Ephemeral", description: "Sterge toate alertele de pret configurate pentru jocul ales.", example: "/price-alert remove joc:elden-ring" },
  { command: "/price-alert list", permissions: "Admin, Ephemeral", description: "Listeaza alertele de pret, pragurile, valutele si starea armata sau declansata.", example: "/price-alert list" },
  { command: "/price-check", permissions: "Public", description: "Cauta pretul jocului pe Steam si il compara cu ofertele comparabile din sursele externe de reduceri folosite de bot. Pretul Steam este afisat in embed verde.", example: "/price-check joc:elden-ring" },
  { command: "/suggest-command add", permissions: "Public, Ephemeral", description: "Permite unui user sa propuna o comanda noua, cu numele si descrierea functionalitatii dorite.", example: "/suggest-command add name:calendar description:Sa arate urmatoarele update-uri programate" },
  { command: "/suggest-command list", permissions: "Admin runtime, Ephemeral", description: "Listeaza comenzile propuse de useri pe server, cu numele propus si ce ar trebui sa faca.", example: "/suggest-command list numar:10" },
  { command: "/youtube subscribe", permissions: "Admin, Ephemeral", description: "Adauga un canal YouTube in lista urmarita folosind un link, un handle @nume sau un channel ID. Videoclipurile mai vechi de o luna sunt ignorate, iar cele recente pot fi livrate la prima activare.", example: "/youtube subscribe canal:@numeCanal" },
  { command: "/youtube unsubscribe", permissions: "Admin, Ephemeral", description: "Scoate un canal YouTube din lista urmarita. Autocomplete afiseaza numai canalele salvate pe server.", example: "/youtube unsubscribe canal:UCxxxxxxxxxxxxxxxxxxxxxx" },
  { command: "/youtube list", permissions: "Admin, Ephemeral", description: "Listeaza canalele YouTube urmarite, ultima verificare si ultima eroare cunoscuta pentru fiecare.", example: "/youtube list" },
  { command: "/youtube notify channel", permissions: "Admin, Ephemeral", description: "Seteaza canalul Discord unde botul posteaza videoclipurile noi si verifica permisiunile Send Messages si Embed Links.", example: "/youtube notify channel channel:#youtube" },
  { command: "/youtube notify on", permissions: "Admin, Ephemeral", description: "Porneste postarile automate pentru canalele YouTube urmarite, folosind canalul Discord configurat.", example: "/youtube notify on" },
  { command: "/youtube notify off", permissions: "Admin, Ephemeral", description: "Opreste postarile automate fara sa stearga lista canalelor YouTube urmarite.", example: "/youtube notify off" },
  { command: "/youtube notify status", permissions: "Admin, Ephemeral", description: "Afiseaza starea notificarilor, canalul Discord, numarul de canale urmarite, filtrele si erorile recente.", example: "/youtube notify status" },
  { command: "/youtube filter shorts", permissions: "Admin, Ephemeral", description: "Activeaza sau dezactiveaza filtrul care evita videoclipurile YouTube Shorts si clipurile de cel mult 60 de secunde.", example: "/youtube filter shorts state:on" },
  { command: "/youtube filter lives", permissions: "Admin, Ephemeral", description: "Activeaza sau dezactiveaza filtrul care evita continutul marcat de YouTube ca livestream.", example: "/youtube filter lives state:on" },
  { command: "/youtube filter premieres", permissions: "Admin, Ephemeral", description: "Activeaza sau dezactiveaza filtrul care evita premierele programate.", example: "/youtube filter premieres state:on" },
  { command: "/youtube filter min-duration", permissions: "Admin, Ephemeral", description: "Seteaza durata minima acceptata pentru un videoclip. Valoarea 0 dezactiveaza limita.", example: "/youtube filter min-duration seconds:61" },
  { command: "/youtube filter status", permissions: "Admin, Ephemeral", description: "Afiseaza filtrele YouTube active si durata minima configurata.", example: "/youtube filter status" },
  { command: "/youtube message-template set", permissions: "Admin, Ephemeral", description: "Seteaza textul atasat notificarilor YouTube. Sunt acceptate variabilele {channel}, {title} si {url}; mentiunile Discord sunt dezactivate.", example: "/youtube message-template set text:Video nou de la {channel}: {title} {url}" },
  { command: "/youtube message-template reset", permissions: "Admin, Ephemeral", description: "Sterge sablonul personalizat si revine la mesajul YouTube implicit.", example: "/youtube message-template reset" },
  { command: "/youtube message-template status", permissions: "Admin, Ephemeral", description: "Afiseaza sablonul de mesaj YouTube folosit in prezent.", example: "/youtube message-template status" },
  { command: "/youtube channel-route add", permissions: "Admin, Ephemeral", description: "Adauga un canal Discord special pentru un canal YouTube urmarit. Cand exista rute speciale, canalul principal nu mai primeste videoclipurile acelui canal YouTube.", example: "/youtube channel-route add canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:#creator" },
  { command: "/youtube channel-route remove", permissions: "Admin, Ephemeral", description: "Sterge o ruta Discord sau toate rutele speciale ale canalului YouTube ales. Dupa eliminarea tuturor se foloseste din nou canalul principal.", example: "/youtube channel-route remove canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:toate" },
  { command: "/youtube channel-route list", permissions: "Admin, Ephemeral", description: "Listeaza toate rutele speciale dintre canalele YouTube si canalele Discord.", example: "/youtube channel-route list" },
  { command: "/youtube title-filter add", permissions: "Admin, Ephemeral", description: "Adauga un cuvant sau o expresie in filtrul inclusiv. Cand lista nu este goala, un titlu trece daca include cel putin una dintre valori.", example: "/youtube title-filter add word:patch notes" },
  { command: "/youtube title-filter remove", permissions: "Admin, Ephemeral", description: "Elimina o valoare din filtrul inclusiv de titlu.", example: "/youtube title-filter remove word:patch notes" },
  { command: "/youtube title-filter list", permissions: "Admin, Ephemeral", description: "Listeaza cuvintele si expresiile acceptate de filtrul inclusiv de titlu.", example: "/youtube title-filter list" },
  { command: "/youtube title-filter clear", permissions: "Admin, Ephemeral", description: "Goleste filtrul inclusiv, astfel incat titlul sa nu mai fie restrictionat.", example: "/youtube title-filter clear" },
  { command: "/youtube videos show", permissions: "Admin, Ephemeral", description: "Posteaza manual videoclipurile din ultima luna pentru un canal urmarit sau pentru toate. Revendica (claim) videoclipurile pe care le posteaza, deci o a doua rulare nu le mai reposteaza (foloseste `repeta:true` ca sa le repostezi); peste 5 rezultate sunt trimise in loturi de 5 la 10 minute, iar loturile suplimentare merg prin outbox-ul durabil cand e activat, chiar daca notificarile automate sunt oprite.", example: "/youtube videos show canal:toate" },
  { command: "/youtube status", permissions: "Admin, Ephemeral", description: "Afiseaza starea completa a modulului YouTube: notificari, canal Discord, canale urmarite, ultima verificare, erori si filtre.", example: "/youtube status" },
  { command: "/youtube errors", permissions: "Admin, Ephemeral", description: "Afiseaza ultimele erori de rezolvare canal, citire feed, metadate video sau livrare Discord.", example: "/youtube errors" },
  { command: "/youtube permissions", permissions: "Admin, Ephemeral", description: "Verifica permisiunile botului pe canalul principal YouTube si pe canalele din rutele speciale (`/youtube channel-route add`).", example: "/youtube permissions" },
  { command: "/youtube clear-errors", permissions: "Admin, Ephemeral", description: "Curata istoricul local al erorilor YouTube dupa ce problema a fost investigata sau rezolvata.", example: "/youtube clear-errors" },
  { command: "/snooze", permissions: "Admin, Ephemeral", description: "Pune temporar pe pauza o comanda existenta a botului pentru server. Comanda aleasa vine din autocomplete, iar durata accepta valori precum 30m, 2h sau 1d.", example: "/snooze command:/latest updates durata:2h", notes: ["Nu poate opri /snooze sau /unsnooze, ca adminii sa poata gestiona mereu pauzele."] },
  { command: "/unsnooze", permissions: "Admin, Ephemeral", description: "Scoate pauza temporara de pe o comanda pusa anterior in snooze.", example: "/unsnooze command:/latest updates" },
  { command: "/start updates", permissions: "Admin", description: "Porneste notificarile automate de update-uri pe canalul curent si face baseline, ca botul sa nu trimita retroactiv toate update-urile vechi.", example: "/start updates" },
  { command: "/start reduceri", permissions: "Admin", description: "Porneste alertele automate de reduceri pe canalul curent si face baseline, ca botul sa trimita doar reducerile noi gasite dupa activare.", example: "/start reduceri" },
  { command: "/stop updates", permissions: "Admin", description: "Opreste notificarile automate de update-uri pentru server.", example: "/stop updates" },
  { command: "/stop reduceri", permissions: "Admin", description: "Opreste alertele automate de reduceri pentru server.", example: "/stop reduceri" },
  { command: "/set mode", permissions: "Admin", description: "Alege formatul embed-urilor de update: compact pentru mesaje scurte sau detailed pentru mai multe detalii.", example: "/set mode value:detailed" },
  { command: "/set mindiscount", permissions: "Admin", description: "Seteaza procentul minim de reducere acceptat pentru alertele de reduceri.", example: "/set mindiscount value:50" },
  { command: "/set maxprice", permissions: "Admin", description: "Seteaza pretul maxim acceptat pentru ofertele platite. Valoarea 0 dezactiveaza limita.", example: "/set maxprice value:100" },
  { command: "/set free", permissions: "Admin", description: "Porneste sau opreste afisarea jocurilor gratuite in alertele de reduceri.", example: "/set free value:on" },
  { command: "/set paid", permissions: "Admin", description: "Porneste sau opreste afisarea ofertelor platite in alertele de reduceri.", example: "/set paid value:on" },
  { command: "/set currency", permissions: "Admin", description: "Alege valuta folosita pentru preturi si alerte de reduceri.", example: "/set currency value:EUR" },
  { command: "/set stores", permissions: "Admin", description: "Filtreaza reducerile dupa magazine, de exemplu Steam si Epic, sau reseteaza filtrul.", example: "/set stores value:steam,epic" },
  { command: "/set outbox-recovery-verify", permissions: "Admin", description: "Activeaza sau dezactiveaza verificarea de recovery pentru outbox pe server. Cand este activa, botul verifica istoricul canalului ca sa previna retrimiterea aceluiasi mesaj dupa un crash.", example: "/set outbox-recovery-verify value:on" },
  { command: "/set games add", permissions: "Admin", description: "Adauga un joc deja cunoscut de bot in lista explicita de jocuri active pentru server.", example: "/set games add joc:cs2", notes: ["Nu adauga un joc nou in codul botului; doar activeaza pentru server un joc existent in configuratie."] },
  { command: "/set games remove", permissions: "Admin", description: "Scoate un joc din lista explicita de jocuri active pentru server.", example: "/set games remove joc:cs2" },
  { command: "/set games reset", permissions: "Admin", description: "Reseteaza filtrul per-joc. Dupa reset, serverul foloseste toate jocurile cunoscute de bot.", example: "/set games reset" },
  { command: "/watchlist show", permissions: "Admin", description: "Afiseaza jocurile urmarite explicit pe server. Daca lista este goala, serverul foloseste toate jocurile configurate.", example: "/watchlist show" },
  { command: "/watchlist add", permissions: "Admin", description: "Adauga un joc deja cunoscut de bot in watchlist-ul serverului.", example: "/watchlist add joc:cs2" },
  { command: "/watchlist remove", permissions: "Admin", description: "Scoate un joc din watchlist-ul serverului.", example: "/watchlist remove joc:cs2" },
  { command: "/watchlist reset", permissions: "Admin", description: "Reseteaza watchlist-ul. Dupa reset, toate jocurile configurate sunt active.", example: "/watchlist reset" },
  { command: "/set role updates", permissions: "Admin", description: "Seteaza rolul pingat la notificarile de update-uri. Daca nu alegi rol, ping-ul se opreste.", example: "/set role updates value:@Updates" },
  { command: "/set role discounts", permissions: "Admin", description: "Seteaza rolul pingat la alertele de reduceri. Daca nu alegi rol, ping-ul se opreste.", example: "/set role discounts value:@Deals" },
  { command: "/outbox status", permissions: "Admin", description: "Afiseaza starea cozii de notificari: cate mesaje asteapta livrare, cate sunt in dead-letter, daca drenarea e pe pauza si starea recovery-verify.", example: "/outbox status", notes: ["Outbox inseamna coada persistenta in MongoDB in care botul pune mesajele de trimis, ca sa nu le piarda la restart sau erori temporare."] },
  { command: "/outbox deadletters", permissions: "Admin", description: "Listeaza livrarile care au esuat definitiv si au fost mutate in dead-letter pentru investigare.", example: "/outbox deadletters", notes: ["Dead-letter inseamna lista de mesaje pe care botul nu le mai retrimite automat fiindca problema pare permanenta sau a depasit numarul de incercari."] },
  { command: "/outbox clear-deadletters", permissions: "Admin", description: "Sterge raportarea dead-letter pentru server dupa ce ai investigat cauza. Nu repara problema si nu retrimite mesajele.", example: "/outbox clear-deadletters" },
  { command: "/outbox replay-deadletters", permissions: "Admin", description: "Reintroduce in outbox livrarile dead-letter care mai au payload salvat, ca botul sa incerce sa le trimita din nou.", example: "/outbox replay-deadletters", notes: ["Foloseste comanda doar dupa ce ai reparat cauza, de exemplu canal lipsa sau permisiuni insuficiente."] },
  { command: "/outbox retry", permissions: "Admin", description: "Reprogrameaza joburile din coada serverului pentru livrare imediata.", example: "/outbox retry" },
  { command: "/outbox drain-now", permissions: "Admin", description: "Porneste manual o drenare a outbox-ului daca drenarea nu este pe pauza si lock-ul global este liber.", example: "/outbox drain-now", notes: ["Drain inseamna procesul prin care botul ia mesajele din coada persistenta si incearca sa le trimita pe Discord."] },
  { command: "/outbox pause", permissions: "Admin", description: "Pune pe pauza drenarea globala a outbox-ului. Mesajele pot ramane in coada, dar worker-ul nu le livreaza pana la resume.", example: "/outbox pause" },
  { command: "/outbox resume", permissions: "Admin", description: "Reia drenarea globala a outbox-ului dupa o pauza.", example: "/outbox resume" },
  { command: "/outbox permissions", permissions: "Admin", description: "Auditeaza permisiunile botului pe canalele configurate pentru notificari si reduceri.", example: "/outbox permissions", notes: ["Verifica View Channel, Send Messages, Embed Links si Read Message History cand recovery-verify are nevoie de istoric."] },
  { command: "/outbox recovery-verify status", permissions: "Admin", description: "Afiseaza starea recovery-verify pentru server si configuratia globala relevanta.", example: "/outbox recovery-verify status", notes: ["Recovery-verify este stratul care cauta markerul mesajului in istoricul canalului dupa crash, ca botul sa evite duplicatele."] },
  { command: "/latest updates", permissions: "Public", description: "Afiseaza cele mai recente update-uri pentru jocurile active ale serverului. Foloseste cache si poate folosi snapshot-ul persistat daca fetch-ul live esueaza.", example: "/latest updates" },
  { command: "/latest reduceri", permissions: "Public", description: "Afiseaza cele mai bune reduceri curente care trec filtrele serverului.", example: "/latest reduceri" },
  { command: "/latest update", permissions: "Public", description: "Cauta ultimul update pentru un joc anume.", example: "/latest update joc:cs2" },
  { command: "/latest pret", permissions: "Public", description: "Cauta pretul curent al unui joc pe Steam.", example: "/latest pret joc:Counter-Strike 2" },
  { command: "/dlc", permissions: "Public", description: "Cauta DLC-uri pentru un joc.", example: "/dlc joc:Counter-Strike 2" },
  { command: "/status", permissions: "Public", description: "Afiseaza statusul unei surse sau al unui joc urmarit.", example: "/status joc:minecraft" },
  { command: "/sources status", permissions: "Admin, Ephemeral", description: "Afiseaza starea ultimelor snapshot-uri pentru sursele de date: reduceri Steam/Epic, feed-uri de update si vechimea ultimului fetch.", example: "/sources status" },
  { command: "/history", permissions: "Public, ephemeral", description: "Afiseaza istoricul recent al notificarilor trimise pe server, filtrat optional dupa update-uri sau reduceri.", example: "/history tip:updates numar:10" },
  { command: "/report submit", permissions: "Public, ephemeral", description: "Trimite un raport despre o problema observata la bot, de exemplu sursa stricata, pret gresit sau update lipsa.", example: "/report submit tip:sursa-stricata detalii:Steam nu raspunde" },
  { command: "/report list", permissions: "Admin runtime, Ephemeral", description: "Listeaza rapoartele recente ale serverului, cu ID-ul necesar pentru rezolvare.", example: "/report list numar:10" },
  { command: "/report resolve", permissions: "Admin runtime, Ephemeral", description: "Marcheaza un raport ca rezolvat dupa ce problema a fost verificata sau reparata.", example: "/report resolve id:64a1f2b3c4d5e6f789012345" },
  { command: "/health", permissions: "Admin", description: "Afiseaza starea tehnica a botului: conexiune Discord, MongoDB, uptime si cache.", example: "/health" }
];

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeCommandHelpQuery(value: unknown): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  return raw.trim().replace(/^\/+/, "").replace(/\s+/g, " ").toLowerCase();
}

function searchKeys(entry: CommandHelpEntry): string[] {
  return [entry.command, ...(entry.aliases || [])].map(normalizeCommandHelpQuery);
}

export function findCommandHelpEntry(value: unknown): CommandHelpEntry | null {
  const query = normalizeCommandHelpQuery(value);
  if (!query) return null;
  return COMMAND_HELP_ENTRIES.find(entry => searchKeys(entry).includes(query)) ?? null;
}

function scoreEntry(entry: CommandHelpEntry, input: string): number {
  if (!input) return 0;
  let score = -1;
  for (const key of searchKeys(entry)) {
    if (key === input) score = Math.max(score, 100);
    else if (key.startsWith(input)) score = Math.max(score, 60);
    else if (key.includes(input)) score = Math.max(score, 30);
  }
  return score;
}

export function buildCommandHelpChoices(inputValue: unknown, options: CommandHelpChoiceOptions = {}): AutocompleteChoice[] {
  const input = normalizeCommandHelpQuery(inputValue).slice(0, 100);
  const excluded = new Set((options.excludeCommands || []).map(normalizeCommandHelpQuery));
  return COMMAND_HELP_ENTRIES
    .filter(entry => !excluded.has(normalizeCommandHelpQuery(entry.command)))
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, input) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_AUTOCOMPLETE_CHOICES)
    .map(({ entry }) => ({
      name: truncateText(`${entry.command} (${entry.permissions})`, MAX_CHOICE_NAME_LEN),
      value: entry.command
    }));
}

export function renderCommandHelpEntry(entry: CommandHelpEntry): string {
  const lines = [
    entry.command,
    `Permisiuni: ${entry.permissions}`,
    `Ce face: ${entry.description}`,
    `Exemplu: ${entry.example}`
  ];
  for (const note of entry.notes || []) {
    lines.push(`Nota: ${note}`);
  }
  return lines.join("\n");
}
