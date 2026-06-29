import type { CurrencyRegistry } from "../../types";
import { REPORT_TYPES } from "../feedback/reportTypes";

type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type SlashChoice = { name: string; value: string };
type SlashCommandJson = ReturnType<InstanceType<typeof import("discord.js").SlashCommandBuilder>["toJSON"]>;

type PermissionsBitFieldLike = { Flags: { Administrator: { toString(): string } } };

interface SlashCommandContext {
  SlashCommandBuilder: typeof import("discord.js").SlashCommandBuilder;
  PermissionsBitField: PermissionsBitFieldLike;
  Routes: {
    applicationCommands(clientId: string): string;
    applicationGuildCommands(clientId: string, guildId: string): string;
  };
  REST: new (options: { version: string }) => {
    setToken(token: string): {
      put(route: string, options: { body: SlashCommandJson[] }): Promise<unknown>;
    };
  };
  SUPPORTED_CURRENCIES: CurrencyRegistry;
  logger: Logger;
  env?: { DISCORD_DEV_GUILD_ID?: string };
  CURRENCY_CHOICES?: SlashChoice[];
  buildSlashCommandDefinitions?: () => SlashCommandJson[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<void>;
}

type SlashCommandDefinitionsDeps = Pick<SlashCommandContext, "SlashCommandBuilder" | "PermissionsBitField" | "Routes" | "REST" | "SUPPORTED_CURRENCIES" | "logger" | "env">;

interface SlashCommandDefinitions {
  CURRENCY_CHOICES: SlashChoice[];
  buildSlashCommandDefinitions: () => SlashCommandJson[];
  registerSlashCommands: (token: string, clientId: string) => Promise<void>;
}

function createSlashCommandDefinitions(deps: SlashCommandDefinitionsDeps): SlashCommandDefinitions {
  const { SlashCommandBuilder, PermissionsBitField, Routes, REST, SUPPORTED_CURRENCIES, logger, env } = deps;

  const CURRENCY_CHOICES: SlashChoice[] = Object.keys(SUPPORTED_CURRENCIES).map(currency => ({
    name: currency,
    value: currency
  }));

  function buildSlashCommandDefinitions(): SlashCommandJson[] {
    return [
      new SlashCommandBuilder().setName("ping").setDescription("Verifica daca botul raspunde"),
      new SlashCommandBuilder().setName("games").setDescription("Listeaza jocurile urmarite (poreclele acceptate)"),
      new SlashCommandBuilder().setName("help").setDescription("Afiseaza meniul de ajutor")
        .addStringOption(option => option.setName("command").setDescription("Comanda pentru explicatie detaliata").setRequired(false).setAutocomplete(true)),
      new SlashCommandBuilder()
        .setName("add")
        .setDescription("Adauga ceva (alerta de pret, joc in watchlist, backup, sugestie de comanda)")
        .addSubcommand(subcommand => subcommand.setName("price-alert").setDescription("Adauga sau actualizeaza o alerta de pret (admin)")
          .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true))
          .addNumberOption(option => option.setName("price").setDescription("Pragul de pret").setRequired(true).setMinValue(0.01).setMaxValue(10000))
          .addStringOption(option => option.setName("currency").setDescription("Valuta pragului").setRequired(true).addChoices(...CURRENCY_CHOICES)))
        .addSubcommand(subcommand => subcommand.setName("watchlist").setDescription("Adauga un joc in watchlist (admin)")
          .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
        .addSubcommand(subcommand => subcommand.setName("backup").setDescription("Salveaza configuratia curenta intr-un backup (admin)")
          .addStringOption(option => option.setName("name").setDescription("Numele backup-ului").setRequired(true).setMaxLength(64)))
        .addSubcommand(subcommand => subcommand.setName("suggestion").setDescription("Propune o comanda noua")
          .addStringOption(option => option.setName("name").setDescription("Numele comenzii propuse").setRequired(true).setMaxLength(80))
          .addStringOption(option => option.setName("description").setDescription("Ce ar trebui sa faca aceasta comanda").setRequired(true).setMaxLength(500))),
      new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Scoate ceva (alerta de pret, joc din watchlist)")
        .addSubcommand(subcommand => subcommand.setName("price-alert").setDescription("Sterge alertele de pret ale unui joc (admin)")
          .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
        .addSubcommand(subcommand => subcommand.setName("watchlist").setDescription("Scoate un joc din watchlist (admin)")
          .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true))),
      new SlashCommandBuilder()
        .setName("config")
        .setDescription("Afiseaza configuratia curenta a serverului (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString()),
      new SlashCommandBuilder()
        .setName("backup")
        .setDescription("Gestioneaza backup-uri ale configuratiei botului pentru server (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza backup-urile salvate"))
        .addSubcommand(subcommand => subcommand.setName("preview").setDescription("Arata ce setari, canale si roluri restaureaza backup-ul")
          .addStringOption(option => option.setName("name").setDescription("Numele backup-ului").setRequired(true).setMaxLength(64)))
        .addSubcommand(subcommand => subcommand.setName("load").setDescription("Incarca un backup salvat")
          .addStringOption(option => option.setName("name").setDescription("Numele backup-ului").setRequired(true).setMaxLength(64))
          .addBooleanOption(option => option.setName("confirm").setDescription("Confirma incarcarea backup-ului").setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName("delete").setDescription("Sterge un backup salvat")
          .addStringOption(option => option.setName("name").setDescription("Numele backup-ului").setRequired(true).setMaxLength(64))
          .addBooleanOption(option => option.setName("confirm").setDescription("Confirma stergerea backup-ului").setRequired(true))),
      new SlashCommandBuilder()
        .setName("bot-log")
        .setDescription("Afiseaza ultimele comenzi admin executate pe server (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("recent").setDescription("Afiseaza cele mai recente comenzi admin")
          .addIntegerOption(option => option.setName("numar").setDescription("Cate intrari (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)))
        .addSubcommand(subcommand => subcommand.setName("older").setDescription("Afiseaza comenzi admin dintr-un interval istoric")
          .addStringOption(option => option.setName("period").setDescription("Intervalul permis").setRequired(true)
            .addChoices({ name: "zi", value: "zi" }, { name: "saptamana", value: "saptamana" }, { name: "luna", value: "luna" }))
          .addStringOption(option => option.setName("start").setDescription("YYYY-MM-DD pentru zi/saptamana sau YYYY-MM pentru luna").setRequired(true))
          .addIntegerOption(option => option.setName("offset").setDescription("De unde incepe urmatorul lot de 25").setRequired(false).setMinValue(0).setMaxValue(1000))),
      new SlashCommandBuilder()
        .setName("server-log")
        .setDescription("Afiseaza ultimele schimbari importante salvate pentru server (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("recent").setDescription("Afiseaza cele mai recente schimbari server")
          .addIntegerOption(option => option.setName("numar").setDescription("Cate intrari (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)))
        .addSubcommand(subcommand => subcommand.setName("older").setDescription("Afiseaza schimbari server dintr-un interval istoric")
          .addStringOption(option => option.setName("period").setDescription("Intervalul permis").setRequired(true)
            .addChoices({ name: "zi", value: "zi" }, { name: "saptamana", value: "saptamana" }, { name: "luna", value: "luna" }))
          .addStringOption(option => option.setName("start").setDescription("YYYY-MM-DD pentru zi/saptamana sau YYYY-MM pentru luna").setRequired(true))
          .addIntegerOption(option => option.setName("offset").setDescription("De unde incepe urmatorul lot de 25").setRequired(false).setMinValue(0).setMaxValue(1000))),
      new SlashCommandBuilder()
        .setName("reset-config")
        .setDescription("Reseteaza toate setarile botului pentru server (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addBooleanOption(option => option.setName("confirm").setDescription("Confirma resetarea completa").setRequired(true)),
      new SlashCommandBuilder()
        .setName("admin-alerts")
        .setDescription("Configureaza canalul alertelor administrative (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("set").setDescription("Seteaza canalul pentru alerte administrative")
          .addChannelOption(option => option.setName("channel").setDescription("Canalul pentru alerte").setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName("off").setDescription("Opreste alertele administrative Discord")),
      new SlashCommandBuilder()
        .setName("price-alert")
        .setDescription("Gestioneaza alertele de pret pentru jocuri (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza alertele de pret configurate")),
      new SlashCommandBuilder()
        .setName("price-check")
        .setDescription("Compara pretul Steam al unui joc cu sursele externe de reduceri")
        .addStringOption(option => option.setName("joc").setDescription("Numele jocului").setRequired(true).setAutocomplete(true)),
      new SlashCommandBuilder()
        .setName("deal-score")
        .setDescription("Calculeaza cat de buna este oferta activa a unui joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true)),
      new SlashCommandBuilder()
        .setName("suggest-command")
        .setDescription("Listeaza comenzi sugerate de useri (propunerea se face cu /add suggestion)")
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza comenzile sugerate (admin)")
          .addIntegerOption(option => option.setName("numar").setDescription("Cate sugestii (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)))
        .addSubcommand(subcommand => subcommand.setName("delete").setDescription("Sterge o comanda sugerata (admin)")
          .addStringOption(option => option.setName("name").setDescription("Numele comenzii sugerate").setRequired(true).setMaxLength(80))),
      new SlashCommandBuilder()
        .setName("watchlist-game")
        .setDescription("Propune jocuri noi pentru lista botului")
        .addSubcommand(subcommand => subcommand.setName("add").setDescription("Propune un joc nou pentru bot")
          .addStringOption(option => option.setName("game").setDescription("Numele jocului propus").setRequired(true).setMaxLength(100)))
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza jocurile propuse")
          .addIntegerOption(option => option.setName("numar").setDescription("Cate propuneri (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)))
        .addSubcommand(subcommand => subcommand.setName("delete").setDescription("Sterge un joc propus (admin)")
          .addStringOption(option => option.setName("game").setDescription("Numele jocului propus").setRequired(true).setMaxLength(100))),
      new SlashCommandBuilder()
        .setName("future-release")
        .setDescription("Gestioneaza jocurile future-release urmarite de bot (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("add").setDescription("Adauga un joc care urmeaza sa apara")
          .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setMaxLength(120))
          .addStringOption(option => option.setName("release-date").setDescription("Data lansarii, daca este cunoscuta").setRequired(false).setMaxLength(40))
          .addStringOption(option => option.setName("preorder-price").setDescription("Pret preorder, daca este cunoscut").setRequired(false).setMaxLength(80)))
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza jocurile future-release"))
        .addSubcommand(subcommand => subcommand.setName("delete").setDescription("Sterge un joc future-release")
          .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setMaxLength(120)))
        .addSubcommand(subcommand => subcommand.setName("start").setDescription("Porneste canalul pentru notificarile future-release"))
        .addSubcommand(subcommand => subcommand.setName("stop").setDescription("Opreste notificarile future-release")),
      new SlashCommandBuilder()
        .setName("maintenance")
        .setDescription("Afiseaza problemele operationale care trebuie verificate (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString()),
      new SlashCommandBuilder()
        .setName("youtube")
        .setDescription("Urmareste canale YouTube si posteaza videoclipurile noi (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("subscribe").setDescription("Adauga un canal YouTube urmarit")
          .addStringOption(option => option.setName("canal").setDescription("Link, @handle sau channel ID").setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName("unsubscribe").setDescription("Scoate un canal YouTube urmarit")
          .addStringOption(option => option.setName("canal").setDescription("Canalul urmarit").setRequired(true).setAutocomplete(true)))
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza canalele YouTube urmarite"))
        .addSubcommandGroup(group => group.setName("notify").setDescription("Configurarea notificarilor YouTube")
          .addSubcommand(subcommand => subcommand.setName("channel").setDescription("Seteaza canalul Discord pentru notificari")
            .addChannelOption(option => option.setName("channel").setDescription("Canalul Discord").setRequired(true)))
          .addSubcommand(subcommand => subcommand.setName("on").setDescription("Porneste notificarile YouTube"))
          .addSubcommand(subcommand => subcommand.setName("off").setDescription("Opreste notificarile YouTube"))
          .addSubcommand(subcommand => subcommand.setName("status").setDescription("Afiseaza starea notificarilor YouTube")))
        .addSubcommandGroup(group => group.setName("filter").setDescription("Filtre pentru videoclipurile YouTube")
          .addSubcommand(subcommand => subcommand.setName("shorts").setDescription("Evita sau permite YouTube Shorts")
            .addStringOption(option => option.setName("state").setDescription("on = evita Shorts").setRequired(true)
              .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
          .addSubcommand(subcommand => subcommand.setName("lives").setDescription("Evita sau permite livestream-uri")
            .addStringOption(option => option.setName("state").setDescription("on = evita live").setRequired(true)
              .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
          .addSubcommand(subcommand => subcommand.setName("premieres").setDescription("Evita sau permite premiere")
            .addStringOption(option => option.setName("state").setDescription("on = evita premiere").setRequired(true)
              .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
          .addSubcommand(subcommand => subcommand.setName("min-duration").setDescription("Seteaza durata minima a videoclipurilor")
            .addIntegerOption(option => option.setName("seconds").setDescription("0-86400 secunde").setRequired(true).setMinValue(0).setMaxValue(86400)))
          .addSubcommand(subcommand => subcommand.setName("status").setDescription("Afiseaza filtrele YouTube curente")))
        .addSubcommandGroup(group => group.setName("message-template").setDescription("Mesajul atasat notificarilor YouTube")
          .addSubcommand(subcommand => subcommand.setName("set").setDescription("Seteaza sablonul mesajului")
            .addStringOption(option => option.setName("text").setDescription("Variabile: {channel}, {title}, {url}").setRequired(true).setMaxLength(1000)))
          .addSubcommand(subcommand => subcommand.setName("reset").setDescription("Revine la sablonul implicit"))
          .addSubcommand(subcommand => subcommand.setName("status").setDescription("Afiseaza sablonul curent")))
        .addSubcommandGroup(group => group.setName("add").setDescription("Adauga rute sau cuvinte de filtru YouTube")
          .addSubcommand(subcommand => subcommand.setName("channel-route").setDescription("Adauga o ruta speciala")
            .addStringOption(option => option.setName("canal").setDescription("Canalul YouTube urmarit").setRequired(true).setAutocomplete(true))
            .addChannelOption(option => option.setName("discord").setDescription("Canalul Discord destinatie").setRequired(true)))
          .addSubcommand(subcommand => subcommand.setName("title-filter").setDescription("Adauga un cuvant sau o expresie in filtrul de titlu")
            .addStringOption(option => option.setName("word").setDescription("Titlul trebuie sa contina cel putin una dintre valori").setRequired(true).setMaxLength(100))))
        .addSubcommandGroup(group => group.setName("remove").setDescription("Sterge rute sau cuvinte de filtru YouTube")
          .addSubcommand(subcommand => subcommand.setName("channel-route").setDescription("Sterge o ruta sau toate rutele unui canal")
            .addStringOption(option => option.setName("canal").setDescription("Canalul YouTube urmarit").setRequired(true).setAutocomplete(true))
            .addStringOption(option => option.setName("discord").setDescription("Canal Discord sau toate").setRequired(true).setAutocomplete(true)))
          .addSubcommand(subcommand => subcommand.setName("title-filter").setDescription("Sterge un cuvant sau o expresie din filtrul de titlu")
            .addStringOption(option => option.setName("word").setDescription("Valoarea de sters").setRequired(true).setAutocomplete(true))))
        .addSubcommandGroup(group => group.setName("channel-route").setDescription("Rute Discord speciale pentru canalele YouTube")
          .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza rutele speciale")))
        .addSubcommandGroup(group => group.setName("title-filter").setDescription("Filtrul inclusiv pentru titlurile YouTube")
          .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza valorile filtrului inclusiv"))
          .addSubcommand(subcommand => subcommand.setName("clear").setDescription("Sterge toate valorile filtrului inclusiv")))
        .addSubcommandGroup(group => group.setName("videos").setDescription("Afisarea manuala a videoclipurilor recente")
          .addSubcommand(subcommand => subcommand.setName("show").setDescription("Posteaza videoclipurile din ultima luna")
            .addStringOption(option => option.setName("canal").setDescription("Canal urmarit sau toate").setRequired(true).setAutocomplete(true))
            .addBooleanOption(option => option.setName("repeta").setDescription("Repostează inclusiv videoclipurile deja afișate manual (implicit nu)").setRequired(false))))
        .addSubcommand(subcommand => subcommand.setName("status").setDescription("Afiseaza starea completa a modulului YouTube"))
        .addSubcommand(subcommand => subcommand.setName("errors").setDescription("Afiseaza ultimele erori YouTube"))
        .addSubcommand(subcommand => subcommand.setName("permissions").setDescription("Verifica permisiunile canalului Discord"))
        .addSubcommand(subcommand => subcommand.setName("clear-errors").setDescription("Sterge istoricul local de erori YouTube")),
      new SlashCommandBuilder()
        .setName("snooze")
        .setDescription("Pune temporar pe pauza o comanda a botului (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addStringOption(option => option.setName("command").setDescription("Comanda de pus pe pauza").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("durata").setDescription("Durata pauzei, de exemplu 30m, 2h sau 1d").setRequired(true)),
      new SlashCommandBuilder()
        .setName("unsnooze")
        .setDescription("Scoate pauza temporara de pe o comanda a botului (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addStringOption(option => option.setName("command").setDescription("Comanda de repornit").setRequired(true).setAutocomplete(true)),
      new SlashCommandBuilder()
        .setName("start")
        .setDescription("Porneste notificarile automate (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Porneste update-urile pe acest canal"))
        .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Porneste alertele de reduceri pe acest canal"))
        .addSubcommand(subcommand => subcommand.setName("dlc").setDescription("Configureaza canalul pentru notificarile DLC")),
      new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Opreste notificarile automate (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Opreste update-urile"))
        .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Opreste alertele de reduceri"))
        .addSubcommand(subcommand => subcommand.setName("dlc").setDescription("Opreste notificarile DLC")),
      new SlashCommandBuilder()
        .setName("set")
        .setDescription("Configureaza preferintele serverului (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("mode").setDescription("Mod afisare embed")
          .addStringOption(option => option.setName("value").setDescription("compact sau detailed").setRequired(true)
            .addChoices({ name: "compact", value: "compact" }, { name: "detailed", value: "detailed" })))
        .addSubcommand(subcommand => subcommand.setName("mindiscount").setDescription("Procent minim reducere (0-100)")
          .addIntegerOption(option => option.setName("value").setDescription("0-100").setRequired(true).setMinValue(0).setMaxValue(100)))
        .addSubcommand(subcommand => subcommand.setName("maxprice").setDescription("Pret maxim absolut pentru oferte (0 = fara limita)")
          .addIntegerOption(option => option.setName("value").setDescription("0-10000 (0 = dezactivat)").setRequired(true).setMinValue(0).setMaxValue(10000)))
        .addSubcommand(subcommand => subcommand.setName("free").setDescription("Afiseaza jocurile gratuite?")
          .addStringOption(option => option.setName("value").setDescription("on/off").setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
        .addSubcommand(subcommand => subcommand.setName("paid").setDescription("Afiseaza ofertele platite?")
          .addStringOption(option => option.setName("value").setDescription("on/off").setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
        .addSubcommand(subcommand => subcommand.setName("currency").setDescription("Valuta pentru afisarea preturilor")
          .addStringOption(option => option.setName("value").setDescription("USD/EUR/GBP/RON").setRequired(true)
            .addChoices(...CURRENCY_CHOICES)))
        .addSubcommand(subcommand => subcommand.setName("stores").setDescription("Filtreaza dupa magazin (steam,epic sau reset)")
          .addStringOption(option => option.setName("value").setDescription("Ex: steam,epic | reset").setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName("outbox-recovery-verify").setDescription("Verificare recovery outbox pentru acest server (on/off)")
          .addStringOption(option => option.setName("value").setDescription("on/off").setRequired(true)
            .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
        .addSubcommandGroup(group => group.setName("add").setDescription("Adauga in watchlist")
          .addSubcommand(subcommand => subcommand.setName("games").setDescription("Adauga un joc in watchlist")
            .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true))))
        .addSubcommandGroup(group => group.setName("remove").setDescription("Scoate din watchlist")
          .addSubcommand(subcommand => subcommand.setName("games").setDescription("Scoate un joc din watchlist")
            .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true))))
        .addSubcommandGroup(group => group.setName("games").setDescription("Filtru per-joc pentru update-uri")
          .addSubcommand(subcommand => subcommand.setName("reset").setDescription("Resetare filtru (toate jocurile active)")))
        .addSubcommandGroup(group => group.setName("role").setDescription("Roluri ping pentru notificari")
          .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Rol pingat la update-uri (gol = oprit)")
            .addRoleOption(option => option.setName("value").setDescription("Rolul de mentionat (gol = oprit)").setRequired(false)))
          .addSubcommand(subcommand => subcommand.setName("discounts").setDescription("Rol pingat la reduceri (gol = oprit)")
            .addRoleOption(option => option.setName("value").setDescription("Rolul de mentionat (gol = oprit)").setRequired(false)))),
      new SlashCommandBuilder()
        .setName("watchlist")
        .setDescription("Gestioneaza jocurile urmarite pe server (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("show").setDescription("Afiseaza jocurile urmarite pe server"))
        .addSubcommand(subcommand => subcommand.setName("reset").setDescription("Reseteaza watchlist-ul la toate jocurile configurate")),
      new SlashCommandBuilder()
        .setName("outbox")
        .setDescription("Operare outbox notificari (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("status").setDescription("Starea outbox-ului (coada, dead-letter, recovery-verify)"))
        .addSubcommand(subcommand => subcommand.setName("deadletters").setDescription("Ultimele livrari ajunse in dead-letter pentru acest server"))
        .addSubcommand(subcommand => subcommand.setName("clear-deadletters").setDescription("Goleste lista de dead-letter a acestui server (dupa ce ai investigat/replay-uit)"))
        .addSubcommand(subcommand => subcommand.setName("replay-deadletters").setDescription("Reintroduce livrarile dead-letter (cu payload stocat) in coada outbox pentru re-trimitere"))
        .addSubcommand(subcommand => subcommand.setName("retry").setDescription("Reprogrameaza joburile din coada ale acestui server pentru livrare imediata"))
        .addSubcommand(subcommand => subcommand.setName("drain-now").setDescription("Forteaza o drenare imediata, doar daca lock-ul outbox_drain e liber"))
        .addSubcommand(subcommand => subcommand.setName("pause").setDescription("Pune pe pauza drenarea outbox-ului (global)"))
        .addSubcommand(subcommand => subcommand.setName("resume").setDescription("Reia drenarea outbox-ului (global)"))
        .addSubcommand(subcommand => subcommand.setName("permissions").setDescription("Auditeaza permisiunile botului pe canalele de notificari/reduceri"))
        .addSubcommandGroup(group => group.setName("recovery-verify").setDescription("Verificare recovery outbox")
          .addSubcommand(subcommand => subcommand.setName("status").setDescription("Starea recovery-verify pentru acest server si global"))),
      new SlashCommandBuilder()
        .setName("latest")
        .setDescription("Comenzi pentru ultimele update-uri/oferte")
        .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Cele mai recente update-uri pentru toate jocurile"))
        .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Cele mai bune reduceri actuale"))
        .addSubcommand(subcommand => subcommand.setName("update").setDescription("Ultimul update pentru un joc specific")
          .addStringOption(option => option.setName("joc").setDescription("Numele/porecla jocului").setRequired(true).setAutocomplete(true)))
        .addSubcommand(subcommand => subcommand.setName("pret").setDescription("Cauta pretul curent pe Steam")
          .addStringOption(option => option.setName("joc").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))),
      new SlashCommandBuilder()
        .setName("dlc")
        .setDescription("Cauta DLC-urile pentru un joc pe Steam")
        .addStringOption(option => option.setName("joc").setDescription("Numele jocului").setRequired(true).setAutocomplete(true)),
      new SlashCommandBuilder()
        .setName("status")
        .setDescription("Verifica status server pentru un joc")
        .addStringOption(option => option.setName("joc").setDescription("Numele/porecla jocului").setRequired(true).setAutocomplete(true)),
      new SlashCommandBuilder()
        .setName("sources")
        .setDescription("Starea surselor externe folosite de bot (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("status").setDescription("Afiseaza starea ultimelor snapshot-uri pentru surse")),
      new SlashCommandBuilder()
        .setName("history")
        .setDescription("Istoricul notificarilor trimise pe acest server")
        .addStringOption(option => option.setName("tip").setDescription("Ce notificari (implicit toate)").setRequired(false)
          .addChoices(
            { name: "updates", value: "updates" },
            { name: "reduceri", value: "reduceri" },
            { name: "youtube", value: "youtube" }
          ))
        .addIntegerOption(option => option.setName("numar").setDescription("Cate intrari (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)),
      new SlashCommandBuilder()
        .setName("report")
        .setDescription("Raporteaza si gestioneaza probleme observate")
        .addSubcommand(subcommand => subcommand.setName("submit").setDescription("Trimite un raport despre o problema")
          .addStringOption(option => option.setName("tip").setDescription("Tipul problemei").setRequired(true)
            .addChoices(...REPORT_TYPES.map(type => ({ name: type.label, value: type.value }))))
          .addStringOption(option => option.setName("detalii").setDescription("Detalii suplimentare (optional)").setRequired(false))
          .addStringOption(option => option.setName("joc").setDescription("Jocul vizat (optional)").setRequired(false)))
        .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza rapoartele recente (admin)")
          .addIntegerOption(option => option.setName("numar").setDescription("Cate rapoarte (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)))
        .addSubcommand(subcommand => subcommand.setName("resolve").setDescription("Marcheaza un raport ca rezolvat (admin)")
          .addStringOption(option => option.setName("id").setDescription("ID-ul raportului din /report list").setRequired(true))),
      new SlashCommandBuilder()
        .setName("health")
        .setDescription("Starea botului: Discord, MongoDB, cache, uptime")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
    ].map(command => command.toJSON())
      .map(definition => definition.default_member_permissions === PermissionsBitField.Flags.Administrator.toString()
        ? { ...definition, dm_permission: false }
        : definition);
  }

  async function registerSlashCommands(token: string, clientId: string): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(token);
    const body = buildSlashCommandDefinitions();
    const devGuildId = env?.DISCORD_DEV_GUILD_ID;
    if (devGuildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body });
      logger("INFO", "SLASH", `Inregistrate ${body.length} slash commands GUILD-scoped pe ${devGuildId} (propagare instant).`);
      return;
    }
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger("INFO", "SLASH", `Inregistrate ${body.length} slash commands global (propagare ~1h).`);
  }

  return { CURRENCY_CHOICES, buildSlashCommandDefinitions, registerSlashCommands };
}

type SlashCommandsInstaller = ((target: SlashCommandContext) => void) & {
  createSlashCommandDefinitions: typeof createSlashCommandDefinitions;
};

const attachSlashCommands = ((target: SlashCommandContext): void => {
  Object.assign(target, createSlashCommandDefinitions(target));
}) as SlashCommandsInstaller;

attachSlashCommands.createSlashCommandDefinitions = createSlashCommandDefinitions;

export = attachSlashCommands;
