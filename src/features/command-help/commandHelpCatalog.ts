"use strict";

type AutocompleteChoice = { name: string; value: string };

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
  { command: "/set games list", permissions: "Admin", description: "Afiseaza lista explicita de jocuri active pentru server.", example: "/set games list" },
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
  { command: "/history", permissions: "Public, ephemeral", description: "Afiseaza istoricul recent al notificarilor trimise pe server, filtrat optional dupa update-uri sau reduceri.", example: "/history tip:updates numar:10" },
  { command: "/report", permissions: "Public, ephemeral", description: "Trimite un raport despre o problema observata la bot, de exemplu sursa stricata, pret gresit sau update lipsa.", example: "/report tip:sursa-stricata detalii:Steam nu mai trimite update-uri" },
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

export function buildCommandHelpChoices(inputValue: unknown): AutocompleteChoice[] {
  const input = normalizeCommandHelpQuery(inputValue).slice(0, 100);
  return COMMAND_HELP_ENTRIES
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
