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
  ,{ command: "security-log", access: "admin", discordAdminPermissions: true }
  ,{ command: "security-status", access: "admin", discordAdminPermissions: true }
  ,{ command: "permission-request", access: "public", discordAdminPermissions: false }
  ,{ command: "permission-requests", access: "admin", discordAdminPermissions: true, ownerOnly: true, ownerOnlySubcommands: ["list"], sensitiveSubcommands: "all" }
  ,{ command: "protected-resource", access: "admin", discordAdminPermissions: true, ownerOnly: true, sensitiveSubcommands: "all" }
  ,{ command: "anti-raid", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: "all", ownerOnlySubcommands: ["force-start", "force-stop", "participant-add", "participant-remove"] }
  ,{ command: "ad-request", access: "public", discordAdminPermissions: false }
  ,{ command: "ad-permissions", access: "admin", discordAdminPermissions: true, ownerOnly: true, ownerOnlySubcommands: ["list"], sensitiveSubcommands: "all" }
  ,{ command: "ad-attempts", access: "admin", discordAdminPermissions: true, sensitiveSubcommands: "all" }
];

export const ADMIN_CATALOG_HELP: readonly CommandCatalogHelpEntry[] = [
  { command: "/backup list", description: "Afiseaza backup-urile salvate pentru server si cine le-a creat.", example: "/backup list" },
  { command: "/backup add", description: "Salveaza configuratia curenta a botului intr-un backup numit; foloseste aceeasi logica precum aliasul /add backup.", example: "/backup add name:inainte-youtube" },
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
  { command: "/delete suggest-command", description: "Sterge o comanda sugerata din lista serverului impreuna cu descrierea ei.", example: "/delete suggest-command name:calendar" },
  { command: "/delete watchlist-game", description: "Sterge un joc din lista propunerilor pentru watchlist; foloseste aceeasi logica precum /watchlist-game delete.", example: "/delete watchlist-game game:silksong" },
  { command: "/maintenance", description: "Afiseaza zonele operationale care trebuie verificate: surse cu erori, outbox, dead-letter, backup vechi, canale lipsa si notificari oprite.", example: "/maintenance" },
  { command: "/template set", description: "Seteaza template-ul unei comenzi si valideaza placeholder-ele acceptate.", example: "/template set command:/start updates text:{count} update-uri noi" },
  { command: "/template reset", description: "Sterge template-ul personalizat si revine la valoarea implicita.", example: "/template reset command:/start updates" },
  { command: "/template status", description: "Afiseaza template-ul activ, valoarea implicita si placeholder-ele disponibile.", example: "/template status command:/youtube notify on" },
  { command: "/game-alias add", description: "Adauga un nume alternativ unic pentru un joc pe server.", example: "/game-alias add joc:counter-strike-2 alias:cs2" },
  { command: "/game-alias remove", description: "Sterge un alias personalizat al jocului.", example: "/game-alias remove joc:counter-strike-2 alias:cs2" },
  { command: "/game-alias list", description: "Listeaza aliasurile personalizate salvate pentru joc.", example: "/game-alias list joc:counter-strike-2" },
  { command: "/notification preview", description: "Previzualizeaza continutul si embed-ul unei notificari cu template-ul activ, fara livrare sau modificarea starii.", example: "/notification preview command:/start updates" }
  ,{ command: "/lock-channel", description: "Blocheaza mesajele membrilor, salveaza starea exacta allow/deny/inherit si accepta motiv text fara linkuri sau atasament direct.", example: "/lock-channel canal:#general motiv:mentenanta" }
  ,{ command: "/unlock-channel", description: "Restaureaza exact permisiunea Send Messages existenta inainte de blocare.", example: "/unlock-channel canal:#general" }
  ,{ command: "/purge", description: "Sterge pana la 50 de mesaje recente si explica limita Discord de 14 zile si mesajele omise.", example: "/purge" }
  ,{ command: "/purge-amount", description: "Sterge pana la numarul indicat de mesaje recente si raporteaza mesajele omise.", example: "/purge-amount numar:50" }
  ,{ command: "/timeout", description: "Aplica timeout atomic fata de persistenta; motivul poate fi text fara linkuri sau atasament direct.", example: "/timeout utilizator:@user durata:30m" }
  ,{ command: "/remove-timeout", description: "Elimina timeout-ul unui membru.", example: "/remove-timeout utilizator:@user" }
  ,{ command: "/timeout-list", description: "Afiseaza timeout-urile active.", example: "/timeout-list" }
  ,{ command: "/mute", description: "Aplica mute atomic fata de persistenta; motivul poate fi text fara linkuri sau atasament direct.", example: "/mute utilizator:@user durata:1h" }
  ,{ command: "/unmute", description: "Elimina mute-ul unui membru.", example: "/unmute utilizator:@user" }
  ,{ command: "/mute-list", description: "Afiseaza mute-urile active.", example: "/mute-list" }
  ,{ command: "/kick", description: "Elimina un membru de pe server.", example: "/kick utilizator:@user" }
  ,{ command: "/ban", description: "Baneaza un membru.", example: "/ban utilizator:@user" }
  ,{ command: "/unban", description: "Debaneaza utilizatorul prin API-ul guild.bans.remove.", example: "/unban utilizator:@user" }
  ,{ command: "/warn", description: "Publica dovada intr-un canal dedicat, persista doar metadatele si poate declansa auto-ban.", example: "/warn utilizator:@user motiv:spam" }
  ,{ command: "/remove-warn", description: "Elimina cel mai recent avertisment.", example: "/remove-warn utilizator:@user" }
  ,{ command: "/warn-list", description: "Afiseaza sumarul avertismentelor grupat pe utilizator: totalul de warn-uri active, sortat descrescator, cu data ultimului warn.", example: "/warn-list" }
  ,{ command: "/warn-ban-limit", description: "Seteaza limita de avertismente pentru ban automat.", example: "/warn-ban-limit numar:3" }
  ,{ command: "/security-log", description: "Afiseaza paginat cronologia incidentelor tuturor protectiilor, cu date periculoase redactate.", example: "/security-log sursa:anti-raid pagina:2" }
  ,{ command: "/security-status", description: "Arata pornit/oprit/incomplet/degradat pentru fiecare protectie si pentru cele sase subprotectii moderation-guard.", example: "/security-status" }
  ,{ command: "/permission-request", description: "Cere aprobarea ownerului pentru o operatiune de securitate: bot-add, permission-grant, moderation-mass, webhook, server-structure sau protected-resource-change.", example: "/permission-request type:webhook target:#anunturi action:create reason:integrare RSS" }
  ,{ command: "/permission-requests list", description: "Listeaza cererile de aprobare de securitate, cu filtre optionale dupa status si tip; cele active apar inaintea istoricului.", example: "/permission-requests list status:pending" }
  ,{ command: "/ad-request", description: "Cere aprobarea proprietarului inainte sa publici o reclama. Cererea salveaza utilizatorul, textul exact, linkul, invitatia si atasamentul; aprobarea e legata de reclama si utilizatorul exacte, se foloseste o singura data si expira.", example: "/ad-request reclama:Intra pe serverul meu" }
  ,{ command: "/ad-permissions list", description: "Afiseaza cererile si aprobarile pentru reclame, cu ID, utilizator, rezumatul reclamei, status, data solicitarii, decizia ownerului, expirarea si folosirea. Cererile active apar inaintea istoricului.", example: "/ad-permissions list" }
  ,{ command: "/ad-attempts list", description: "Afiseaza tentativele active 0/3, 1/3 sau 2/3 ale unui membru, totalul reclamelor sterse, warn-urile automate, ultima tentativa, canalul si istoricul grupurilor de trei tentative.", example: "/ad-attempts list utilizator:@membru" }
  ,{ command: "/anti-raid status", description: "Arata incidentul anti-raid activ sau ultimul: ID, etapa, canalele blocate acum, participantii opriti si cei ramasi, durata lockdown-ului, timpul ramas din perioada de siguranta, progresul restaurarii, operatiunile ramase si erorile.", example: "/anti-raid status" }
  ,{ command: "/anti-raid participant-list", description: "Listeaza participantii incidentului activ, ai ultimului raid sau ai incidentului indicat, cu sanctiunile aplicate, cele esuate si ultima eroare.", example: "/anti-raid participant-list incident-id:raid-abc" }
  ,{ command: "/anti-raid force-start", description: "Confirma manual un raid, genereaza un ID de incident si porneste interventia. Owner-only.", example: "/anti-raid force-start" }
  ,{ command: "/anti-raid force-stop", description: "Incheie manual interventia si porneste restaurarea controlata. Se poate folosi numai dupa un raid confirmat si nu anuleaza sanctiunile aplicate. Owner-only.", example: "/anti-raid force-stop confirm:true" }
  ,{ command: "/anti-raid participant-add", description: "Adauga manual un participant omis si il introduce in fluxul Mute 24h -> Timeout 24h -> Ban. Owner-only.", example: "/anti-raid participant-add utilizator:@membru" }
  ,{ command: "/anti-raid participant-remove", description: "Elimina din incident un participant identificat gresit. NU anuleaza automat sanctiunile deja aplicate. Owner-only.", example: "/anti-raid participant-remove utilizator:@membru" }
  ,{ command: "/protected-resource", description: "Marcheaza canale, categorii si roluri ca resurse critice. add salveaza snapshot-ul si evalueaza daca prevenirea poate fi garantata, remove scoate resursa din protectie fara sa o stearga, list arata resursele, starea snapshot-ului si cauzele exacte pentru cele degraded.", example: "/protected-resource action:add type:channel target:123456789012345678", notes: ["Aplicarea in afara raidurilor porneste doar cand /start moderation-guard este activ.", "O resursa e marcata degraded cand prevenirea nu poate fi garantata, de exemplu roluri cu Administrator care ignora overwrite-urile canalului sau un rol protejat mai sus decat rolul botului."] }
];
