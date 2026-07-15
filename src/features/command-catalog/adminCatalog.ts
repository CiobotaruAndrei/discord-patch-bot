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
  ,{ command: "lock-channel", access: "admin", discordAdminPermissions: true }
  ,{ command: "unlock-channel", access: "admin", discordAdminPermissions: true }
  ,{ command: "purge", access: "admin", discordAdminPermissions: true }
  ,{ command: "purge-amount", access: "admin", discordAdminPermissions: true }
  ,{ command: "timeout", access: "admin", discordAdminPermissions: true }
  ,{ command: "remove-timeout", access: "admin", discordAdminPermissions: true }
  ,{ command: "timeout-list", access: "public", discordAdminPermissions: false }
  ,{ command: "mute", access: "admin", discordAdminPermissions: true }
  ,{ command: "unmute", access: "admin", discordAdminPermissions: true }
  ,{ command: "mute-list", access: "public", discordAdminPermissions: false }
  ,{ command: "kick", access: "admin", discordAdminPermissions: true }
  ,{ command: "ban", access: "admin", discordAdminPermissions: true }
  ,{ command: "unban", access: "admin", discordAdminPermissions: true }
  ,{ command: "warn", access: "admin", discordAdminPermissions: true }
  ,{ command: "remove-warn", access: "admin", discordAdminPermissions: true }
  ,{ command: "warn-list", access: "public", discordAdminPermissions: false }
  ,{ command: "warn-ban-limit", access: "admin", discordAdminPermissions: true }
  ,{ command: "bot-add-request", access: "admin", discordAdminPermissions: true }
  ,{ command: "bot-add-permissions", access: "admin", discordAdminPermissions: true }
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
  ,{ command: "/lock-channel", description: "Blocheaza mesajele membrilor in canalul selectat, cu un motiv.", example: "/lock-channel canal:#general motiv:mentenanta" }
  ,{ command: "/unlock-channel", description: "Deblocheaza mesajele membrilor in canalul selectat.", example: "/unlock-channel canal:#general" }
  ,{ command: "/purge", description: "Sterge ultimele 50 de mesaje din canalul curent.", example: "/purge" }
  ,{ command: "/purge-amount", description: "Sterge numarul indicat de mesaje din canalul curent.", example: "/purge-amount numar:50" }
  ,{ command: "/timeout", description: "Aplica timeout unui membru.", example: "/timeout utilizator:@user durata:30m" }
  ,{ command: "/remove-timeout", description: "Elimina timeout-ul unui membru.", example: "/remove-timeout utilizator:@user" }
  ,{ command: "/timeout-list", description: "Afiseaza timeout-urile active.", example: "/timeout-list" }
  ,{ command: "/mute", description: "Aplica mute unui membru.", example: "/mute utilizator:@user durata:1h" }
  ,{ command: "/unmute", description: "Elimina mute-ul unui membru.", example: "/unmute utilizator:@user" }
  ,{ command: "/mute-list", description: "Afiseaza mute-urile active.", example: "/mute-list" }
  ,{ command: "/kick", description: "Elimina un membru de pe server.", example: "/kick utilizator:@user" }
  ,{ command: "/ban", description: "Baneaza un membru.", example: "/ban utilizator:@user" }
  ,{ command: "/unban", description: "Debaneaza un utilizator.", example: "/unban utilizator:@user" }
  ,{ command: "/warn", description: "Avertizeaza un membru cu un motiv.", example: "/warn utilizator:@user motiv:spam" }
  ,{ command: "/remove-warn", description: "Elimina cel mai recent avertisment.", example: "/remove-warn utilizator:@user" }
  ,{ command: "/warn-list", description: "Afiseaza utilizatorii cu avertismente active.", example: "/warn-list" }
  ,{ command: "/warn-ban-limit", description: "Seteaza limita de avertismente pentru ban automat.", example: "/warn-ban-limit numar:3" }
  ,{ command: "/bot-add-request", description: "Solicita aprobarea proprietarului pentru un bot nou.", example: "/bot-add-request bot-id:123456789012345678" }
  ,{ command: "/bot-add-permissions", description: "Listeaza solicitarile de adaugare boti.", example: "/bot-add-permissions" }
];
