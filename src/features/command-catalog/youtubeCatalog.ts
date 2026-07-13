import type { CommandAccessRule, CommandCatalogHelpEntry } from "./commandCatalogTypes.js";

export const YOUTUBE_COMMAND_ACCESS: readonly CommandAccessRule[] = [
  { command: "youtube", access: "admin", discordAdminPermissions: true }
];

export const YOUTUBE_CATALOG_HELP: readonly CommandCatalogHelpEntry[] = [
  { command: "/youtube subscribe", description: "Adauga un canal YouTube in lista urmarita folosind un link, un handle @nume sau un channel ID. Videoclipurile mai vechi de o luna sunt ignorate, iar cele recente pot fi livrate la prima activare.", example: "/youtube subscribe canal:@numeCanal" },
  { command: "/youtube unsubscribe", description: "Scoate un canal YouTube din lista urmarita. Autocomplete afiseaza numai canalele salvate pe server.", example: "/youtube unsubscribe canal:UCxxxxxxxxxxxxxxxxxxxxxx" },
  { command: "/youtube list", description: "Listeaza canalele YouTube urmarite, ultima verificare si ultima eroare cunoscuta pentru fiecare.", example: "/youtube list" },
  { command: "/youtube notify channel", description: "Seteaza canalul Discord unde botul posteaza videoclipurile noi si verifica permisiunile View Channel, Send Messages si Embed Links.", example: "/youtube notify channel channel:#youtube" },
  { command: "/youtube notify on", description: "Porneste postarile automate pentru canalele YouTube urmarite, folosind canalul Discord configurat.", example: "/youtube notify on" },
  { command: "/youtube notify off", description: "Opreste postarile automate fara sa stearga lista canalelor YouTube urmarite.", example: "/youtube notify off" },
  { command: "/youtube notify status", description: "Afiseaza starea notificarilor, canalul Discord, numarul de canale urmarite, filtrele si erorile recente.", example: "/youtube notify status" },
  { command: "/youtube filter shorts", description: "Activeaza sau dezactiveaza filtrul care evita videoclipurile YouTube Shorts si clipurile de cel mult 60 de secunde.", example: "/youtube filter shorts state:on" },
  { command: "/youtube filter lives", description: "Activeaza sau dezactiveaza filtrul care evita continutul marcat de YouTube ca livestream.", example: "/youtube filter lives state:on" },
  { command: "/youtube filter premieres", description: "Activeaza sau dezactiveaza filtrul care evita premierele programate.", example: "/youtube filter premieres state:on" },
  { command: "/youtube filter min-duration", description: "Seteaza durata minima acceptata pentru un videoclip. Valoarea 0 dezactiveaza limita.", example: "/youtube filter min-duration seconds:61" },
  { command: "/youtube filter status", description: "Afiseaza filtrele YouTube active si durata minima configurata.", example: "/youtube filter status" },
  { command: "/youtube add channel-route", description: "Adauga un canal Discord special pentru un canal YouTube urmarit. Cand exista rute speciale, canalul principal nu mai primeste videoclipurile acelui canal YouTube.", example: "/youtube add channel-route canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:#creator" },
  { command: "/youtube remove channel-route", description: "Sterge o ruta Discord sau toate rutele speciale ale canalului YouTube ales. Dupa eliminarea tuturor se foloseste din nou canalul principal.", example: "/youtube remove channel-route canal:UCxxxxxxxxxxxxxxxxxxxxxx discord:toate" },
  { command: "/youtube channel-route list", description: "Listeaza toate rutele speciale dintre canalele YouTube si canalele Discord.", example: "/youtube channel-route list" },
  { command: "/youtube add title-filter", description: "Adauga un cuvant sau o expresie in filtrul inclusiv. Cand lista nu este goala, un titlu trece daca include cel putin una dintre valori.", example: "/youtube add title-filter word:patch notes" },
  { command: "/youtube remove title-filter", description: "Elimina o valoare din filtrul inclusiv de titlu.", example: "/youtube remove title-filter word:patch notes" },
  { command: "/youtube title-filter list", description: "Listeaza cuvintele si expresiile acceptate de filtrul inclusiv de titlu.", example: "/youtube title-filter list" },
  { command: "/youtube title-filter clear", description: "Goleste filtrul inclusiv, astfel incat titlul sa nu mai fie restrictionat.", example: "/youtube title-filter clear" },
  { command: "/youtube status", description: "Afiseaza starea completa a modulului YouTube: notificari, canal Discord, canale urmarite, ultima verificare, erori si filtre.", example: "/youtube status" },
  { command: "/youtube clear-errors", description: "Curata istoricul local al erorilor YouTube dupa ce problema a fost investigata sau rezolvata.", example: "/youtube clear-errors" }
];
