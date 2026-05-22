type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

type SlashChoice = { name: string; value: string };

type SlashStringOptionBuilderLike = {
  setName(name: string): SlashStringOptionBuilderLike;
  setDescription(description: string): SlashStringOptionBuilderLike;
  setRequired(required: boolean): SlashStringOptionBuilderLike;
  setAutocomplete(enabled: boolean): SlashStringOptionBuilderLike;
  addChoices(...choices: SlashChoice[]): SlashStringOptionBuilderLike;
};

type SlashIntegerOptionBuilderLike = {
  setName(name: string): SlashIntegerOptionBuilderLike;
  setDescription(description: string): SlashIntegerOptionBuilderLike;
  setRequired(required: boolean): SlashIntegerOptionBuilderLike;
  setMinValue(value: number): SlashIntegerOptionBuilderLike;
  setMaxValue(value: number): SlashIntegerOptionBuilderLike;
};

type SlashRoleOptionBuilderLike = {
  setName(name: string): SlashRoleOptionBuilderLike;
  setDescription(description: string): SlashRoleOptionBuilderLike;
  setRequired(required: boolean): SlashRoleOptionBuilderLike;
};

type SlashSubcommandBuilderLike = {
  setName(name: string): SlashSubcommandBuilderLike;
  setDescription(description: string): SlashSubcommandBuilderLike;
  addStringOption(configure: (option: SlashStringOptionBuilderLike) => SlashStringOptionBuilderLike): SlashSubcommandBuilderLike;
  addIntegerOption(configure: (option: SlashIntegerOptionBuilderLike) => SlashIntegerOptionBuilderLike): SlashSubcommandBuilderLike;
  addRoleOption(configure: (option: SlashRoleOptionBuilderLike) => SlashRoleOptionBuilderLike): SlashSubcommandBuilderLike;
};

type SlashSubcommandGroupBuilderLike = {
  setName(name: string): SlashSubcommandGroupBuilderLike;
  setDescription(description: string): SlashSubcommandGroupBuilderLike;
  addSubcommand(configure: (subcommand: SlashSubcommandBuilderLike) => SlashSubcommandBuilderLike): SlashSubcommandGroupBuilderLike;
};

type SlashCommandBuilderLike = {
  setName(name: string): SlashCommandBuilderLike;
  setDescription(description: string): SlashCommandBuilderLike;
  setDefaultMemberPermissions(permissions: string): SlashCommandBuilderLike;
  addSubcommand(configure: (subcommand: SlashSubcommandBuilderLike) => SlashSubcommandBuilderLike): SlashCommandBuilderLike;
  addSubcommandGroup(configure: (group: SlashSubcommandGroupBuilderLike) => SlashSubcommandGroupBuilderLike): SlashCommandBuilderLike;
  addStringOption(configure: (option: SlashStringOptionBuilderLike) => SlashStringOptionBuilderLike): SlashCommandBuilderLike;
  toJSON(): unknown;
};

type SlashCommandBuilderConstructor = new () => SlashCommandBuilderLike;
type PermissionsBitFieldLike = { Flags: { Administrator: { toString(): string } } };

interface SlashCommandContext {
  SlashCommandBuilder: SlashCommandBuilderConstructor;
  PermissionsBitField: PermissionsBitFieldLike;
  Routes: {
    applicationCommands(clientId: string): string;
  };
  REST: new (options: { version: string }) => {
    setToken(token: string): {
      put(route: string, options: { body: unknown[] }): Promise<unknown>;
    };
  };
  SUPPORTED_CURRENCIES: Record<string, unknown>;
  logger: Logger;
  CURRENCY_CHOICES?: SlashChoice[];
  buildSlashCommandDefinitions?: () => unknown[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<void>;
}

function attachSlashCommands(ctx: SlashCommandContext): void {
  const { SlashCommandBuilder, PermissionsBitField, Routes, REST, SUPPORTED_CURRENCIES, logger } = ctx;

  const CURRENCY_CHOICES: SlashChoice[] = Object.keys(SUPPORTED_CURRENCIES).map(currency => ({
    name: currency,
    value: currency
  }));

  // V9: definitii slash extinse - autocomplete + subcomenzi noi.
  function buildSlashCommandDefinitions(): unknown[] {
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
        .addStringOption(option => option.setName("joc").setDescription("Numele/porecla jocului").setRequired(true).setAutocomplete(true))
    ].map(command => command.toJSON());
  }

  async function registerSlashCommands(token: string, clientId: string): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(token);
    const body = buildSlashCommandDefinitions();
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger("INFO", "SLASH", `Inregistrate ${body.length} slash commands global.`);
  }

  Object.assign(ctx, {
    CURRENCY_CHOICES,
    buildSlashCommandDefinitions,
    registerSlashCommands
  });
}

export = attachSlashCommands;
