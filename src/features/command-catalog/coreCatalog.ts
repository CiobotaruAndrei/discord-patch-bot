import type { CommandAccessRule, CommandCatalogHelpEntry } from "./commandCatalogTypes.js";

export const CORE_COMMAND_ACCESS: readonly CommandAccessRule[] = [
  { command: "ping", access: "public", discordAdminPermissions: false },
  { command: "games", access: "public", discordAdminPermissions: false },
  { command: "help", access: "public", discordAdminPermissions: false },
  { command: "status", access: "public", discordAdminPermissions: false },
  { command: "history", access: "public", discordAdminPermissions: false },
  { command: "report", access: "public", discordAdminPermissions: false, adminRuntimeSubcommands: ["list", "resolve"] },
  { command: "suggest-command", access: "public", discordAdminPermissions: false, adminRuntimeSubcommands: ["list", "delete"] },
  { command: "add", access: "admin", discordAdminPermissions: false, publicSubcommands: ["suggestion"] },
  { command: "remove", access: "admin", discordAdminPermissions: false },
  { command: "snooze", access: "admin", discordAdminPermissions: true },
  { command: "unsnooze", access: "admin", discordAdminPermissions: true },
  { command: "config", access: "admin", discordAdminPermissions: true },
  { command: "health", access: "admin", discordAdminPermissions: true }
];

export const CORE_CATALOG_HELP: readonly CommandCatalogHelpEntry[] = [
  { command: "/ping", description: "Verifica rapid daca botul raspunde la Discord.", example: "/ping" },
  { command: "/games", description: "Listeaza jocurile cunoscute de bot si cheile/poreclele pe care le poti folosi in comenzile cu joc.", example: "/games" },
  { command: "/help", description: "Afiseaza meniul general de ajutor. Daca alegi o comanda in optiunea command, primesti explicatia detaliata pentru comanda aceea.", example: "/help command:/set add games" },
  { command: "/config", description: "Afiseaza intr-un singur loc setarile curente ale serverului: mode, filtre de reduceri, valuta, store-uri, jocuri active, roluri si canale.", example: "/config" },
  { command: "/add backup", description: "Salveaza configuratia curenta a botului pentru server intr-un backup numit. Backup-ul include canale, roluri, filtre, watchlist, snooze-uri, alerte de pret si configurarea YouTube.", example: "/add backup name:inainte-youtube" },
  { command: "/add price-alert", description: "Adauga sau actualizeaza o alerta care se declanseaza cand jocul ajunge la sau sub pragul ales, in valuta aleasa.", example: "/add price-alert joc:elden-ring price:30 currency:EUR", notes: ["Alerta foloseste canalul configurat prin /start reduceri si se rearmeaza dupa ce pretul urca din nou peste prag."] },
  { command: "/remove price-alert", description: "Sterge toate alertele de pret configurate pentru jocul ales.", example: "/remove price-alert joc:elden-ring" },
  { command: "/add suggestion", ephemeral: true, description: "Permite unui user sa propuna o comanda noua, cu numele si descrierea functionalitatii dorite.", example: "/add suggestion name:calendar description:Sa arate urmatoarele update-uri programate" },
  { command: "/suggest-command list", description: "Listeaza comenzile propuse de useri pe server, cu numele propus si ce ar trebui sa faca.", example: "/suggest-command list numar:10" },
  { command: "/suggest-command delete", description: "Sterge o comanda sugerata din lista serverului impreuna cu descrierea ei.", example: "/suggest-command delete name:calendar" },
  { command: "/snooze", description: "Pune temporar pe pauza o comanda existenta a botului pentru server. Comanda aleasa vine din autocomplete, iar durata accepta valori precum 30m, 2h sau 1d.", example: "/snooze command:/latest updates durata:2h", notes: ["Nu poate opri /snooze sau /unsnooze, ca adminii sa poata gestiona mereu pauzele."] },
  { command: "/unsnooze", description: "Scoate pauza temporara de pe o comanda pusa anterior in snooze.", example: "/unsnooze command:/latest updates" },
  { command: "/add watchlist", description: "Adauga un joc deja cunoscut de bot in watchlist-ul serverului.", example: "/add watchlist joc:cs2" },
  { command: "/remove watchlist", description: "Scoate un joc din watchlist-ul serverului.", example: "/remove watchlist joc:cs2" },
  { command: "/status", description: "Afiseaza statusul unei surse sau al unui joc urmarit.", example: "/status joc:minecraft" },
  { command: "/history", ephemeral: true, description: "Afiseaza istoricul recent al notificarilor trimise pe server, filtrat optional dupa update-uri, reduceri sau YouTube.", example: "/history tip:youtube numar:10" },
  { command: "/report submit", ephemeral: true, description: "Trimite un raport despre o problema observata la bot, de exemplu sursa stricata, pret gresit sau update lipsa.", example: "/report submit tip:sursa-stricata detalii:Steam nu raspunde" },
  { command: "/report list", description: "Listeaza rapoartele recente ale serverului, cu ID-ul necesar pentru rezolvare.", example: "/report list numar:10" },
  { command: "/report resolve", description: "Marcheaza un raport ca rezolvat dupa ce problema a fost verificata sau reparata.", example: "/report resolve id:64a1f2b3c4d5e6f789012345" },
  { command: "/health", description: "Afiseaza starea tehnica a botului: conexiune Discord, MongoDB, uptime si cache.", example: "/health" }
];
