import type { CurrencyRegistry } from "../../types";

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
      new SlashCommandBuilder().setName("help").setDescription("Afiseaza meniul de ajutor"),
      new SlashCommandBuilder()
        .setName("start")
        .setDescription("Porneste notificarile automate (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Porneste update-urile pe acest canal"))
        .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Porneste alertele de reduceri pe acest canal")),
      new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Opreste notificarile automate (admin)")
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
        .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Opreste update-urile"))
        .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Opreste alertele de reduceri")),
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
        .addSubcommandGroup(group => group.setName("games").setDescription("Filtru per-joc pentru update-uri")
          .addSubcommand(subcommand => subcommand.setName("add").setDescription("Adauga un joc la lista activa")
            .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
          .addSubcommand(subcommand => subcommand.setName("remove").setDescription("Scoate un joc din lista activa")
            .addStringOption(option => option.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
          .addSubcommand(subcommand => subcommand.setName("reset").setDescription("Resetare filtru (toate jocurile active)"))
          .addSubcommand(subcommand => subcommand.setName("list").setDescription("Afiseaza jocurile active explicit")))
        .addSubcommandGroup(group => group.setName("role").setDescription("Roluri ping pentru notificari")
          .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Rol pingat la update-uri (gol = oprit)")
            .addRoleOption(option => option.setName("value").setDescription("Rolul de mentionat (gol = oprit)").setRequired(false)))
          .addSubcommand(subcommand => subcommand.setName("discounts").setDescription("Rol pingat la reduceri (gol = oprit)")
            .addRoleOption(option => option.setName("value").setDescription("Rolul de mentionat (gol = oprit)").setRequired(false)))),
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
        .setName("history")
        .setDescription("Istoricul notificarilor trimise pe acest server")
        .addStringOption(option => option.setName("tip").setDescription("Ce notificari (implicit toate)").setRequired(false)
          .addChoices({ name: "updates", value: "updates" }, { name: "reduceri", value: "reduceri" }))
        .addIntegerOption(option => option.setName("numar").setDescription("Cate intrari (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25)),
      new SlashCommandBuilder()
        .setName("report")
        .setDescription("Raporteaza o problema (update gresit, duplicat, joc lipsa, sursa stricata)")
        .addStringOption(option => option.setName("tip").setDescription("Tipul problemei").setRequired(true)
          .addChoices(
            { name: "Update gresit/inexact", value: "update-gresit" },
            { name: "Notificare duplicata", value: "duplicat" },
            { name: "Joc sau sursa lipsa", value: "joc-lipsa" },
            { name: "Sursa stricata (nu mai vin update-uri)", value: "sursa-stricata" },
            { name: "Altceva", value: "altceva" }
          ))
        .addStringOption(option => option.setName("detalii").setDescription("Detalii suplimentare (optional)").setRequired(false))
        .addStringOption(option => option.setName("joc").setDescription("Jocul vizat (optional)").setRequired(false)),
      new SlashCommandBuilder()
        .setName("health")
        .setDescription("Starea botului: Discord, MongoDB, cache, uptime")
    ].map(command => command.toJSON());
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
