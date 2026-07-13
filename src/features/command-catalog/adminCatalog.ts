import type { CommandAccessRule, CommandCatalogHelpEntry } from "./commandCatalogTypes.js";

export const ADMIN_COMMAND_ACCESS: readonly CommandAccessRule[] = [
  { command: "delete", access: "admin", discordAdminPermissions: true, ownerOnlySubcommands: ["admin-command-access"] },
  { command: "reset-config", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: "all" },
  { command: "backup", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: ["load", "delete"] },
  { command: "bot-log", access: "admin", discordAdminPermissions: true },
  { command: "server-log", access: "admin", discordAdminPermissions: true },
  { command: "admin-alerts", access: "admin", discordAdminPermissions: true },
  { command: "admin-command-access", access: "admin", discordAdminPermissions: true, ownerOnly: true },
  { command: "maintenance", access: "admin", discordAdminPermissions: true },
  { command: "template", access: "admin", discordAdminPermissions: true },
  { command: "game-alias", access: "admin", discordAdminPermissions: true },
  { command: "notification", access: "admin", discordAdminPermissions: true }
];

export const ADMIN_CATALOG_HELP: readonly CommandCatalogHelpEntry[] = [
  { command: "/backup list", description: "Afiseaza backup-urile salvate pentru server si cine le-a creat.", example: "/backup list" },
  { command: "/backup preview", description: "Arata ce setari, canale si roluri vor fi restaurate daca incarci backup-ul ales.", example: "/backup preview name:inainte-youtube" },
  { command: "/backup load", description: "Incarca un backup salvat si restaureaza configuratia botului pentru server. Cere confirmare explicita.", example: "/backup load name:inainte-youtube confirm:true" },
  { command: "/backup delete", description: "Sterge un backup salvat. Cere confirmare explicita ca sa nu fie sters accidental.", example: "/backup delete name:inainte-youtube confirm:true" },
  { command: "/bot-log recent", description: "Afiseaza cele mai recente comenzi admin executate pe server, cu user, comanda, data si rezultat.", example: "/bot-log recent numar:10" },
  { command: "/bot-log older", description: "Afiseaza comenzi admin dintr-o zi, o saptamana sau o luna anume. Pentru luna foloseste start in format YYYY-MM; pentru zi si saptamana foloseste YYYY-MM-DD.", example: "/bot-log older period:luna start:2025-08" },
  { command: "/server-log recent", description: "Afiseaza cele mai recente schimbari importante salvate pentru server.", example: "/server-log recent numar:10" },
  { command: "/server-log older", description: "Afiseaza schimbari server dintr-o zi, o saptamana sau o luna anume. Pentru luna foloseste start in format YYYY-MM; pentru zi si saptamana foloseste YYYY-MM-DD.", example: "/server-log older period:luna start:2025-08" },
  { command: "/reset-config", description: "Reseteaza toate setarile botului pentru server la valorile implicite. Istoricul rapoartelor si al notificarilor ramane pastrat.", example: "/reset-config confirm:true", notes: ["Resetarea ruleaza numai cand confirm este true."] },
  { command: "/admin-alerts set", description: "Seteaza canalul in care botul trimite alerte administrative despre erori operationale, dead-letter, permisiuni si rapoarte noi.", example: "/admin-alerts set channel:#bot-logs" },
  { command: "/admin-alerts off", description: "Opreste livrarea alertelor administrative in Discord pentru server.", example: "/admin-alerts off" },
  { command: "/admin-command-access list", description: "Afiseaza regula globala si regulile dedicate pe comenzi admin. Cu command afiseaza regula exacta pentru comanda aleasa sau fallback-ul global folosit.", example: "/admin-command-access list command:/start updates" },
  { command: "/delete admin-command-access", description: "Sterge regula de rol globala sau regula dedicata unei comenzi admin si revine la fallback-ul ramas: regula globala, Administrator sau cod global de acces.", example: "/delete admin-command-access confirm:true command:/start updates" },
  { command: "/maintenance", description: "Afiseaza zonele operationale care trebuie verificate: surse cu erori, outbox, dead-letter, backup vechi, canale lipsa si notificari oprite.", example: "/maintenance" },
  { command: "/template set", description: "Seteaza template-ul unei comenzi si valideaza placeholder-ele acceptate.", example: "/template set command:/start updates text:{count} update-uri noi" },
  { command: "/template reset", description: "Sterge template-ul personalizat si revine la valoarea implicita.", example: "/template reset command:/start updates" },
  { command: "/template status", description: "Afiseaza template-ul activ, valoarea implicita si placeholder-ele disponibile.", example: "/template status command:/youtube notify on" },
  { command: "/game-alias add", description: "Adauga un nume alternativ unic pentru un joc pe server.", example: "/game-alias add joc:counter-strike-2 alias:cs2" },
  { command: "/game-alias remove", description: "Sterge un alias personalizat al jocului.", example: "/game-alias remove joc:counter-strike-2 alias:cs2" },
  { command: "/game-alias list", description: "Listeaza aliasurile personalizate salvate pentru joc.", example: "/game-alias list joc:counter-strike-2" },
  { command: "/notification preview", description: "Previzualizeaza continutul si embed-ul unei notificari cu template-ul activ, fara livrare sau modificarea starii.", example: "/notification preview command:/start updates" }
];
