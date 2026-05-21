type Logger = (level: string, context: string, message: string, meta?: unknown) => void;

interface SlashCommandContext {
  SlashCommandBuilder: any;
  PermissionsBitField: any;
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
  CURRENCY_CHOICES?: Array<{ name: string; value: string }>;
  buildSlashCommandDefinitions?: () => unknown[];
  registerSlashCommands?: (token: string, clientId: string) => Promise<void>;
}

function attachSlashCommands(ctx: SlashCommandContext): void {
  const { SlashCommandBuilder, PermissionsBitField, Routes, REST, SUPPORTED_CURRENCIES, logger } = ctx;

const CURRENCY_CHOICES = Object.keys(SUPPORTED_CURRENCIES).map(c => ({ name: c, value: c }));

// V9: definiții slash extinse — autocomplete + subcomenzi noi.
function buildSlashCommandDefinitions(): unknown[] {
  return [
    new SlashCommandBuilder().setName("ping").setDescription("Verifica daca botul raspunde"),
    new SlashCommandBuilder().setName("games").setDescription("Listeaza jocurile urmarite (poreclele acceptate)"),
    new SlashCommandBuilder().setName("help").setDescription("Afiseaza meniul de ajutor"),
    new SlashCommandBuilder()
      .setName("start")
      .setDescription("Porneste notificarile automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand((s: any) => s.setName("updates").setDescription("Porneste update-urile pe acest canal"))
      .addSubcommand((s: any) => s.setName("reduceri").setDescription("Porneste alertele de reduceri pe acest canal")),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Opreste notificarile automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand((s: any) => s.setName("updates").setDescription("Opreste update-urile"))
      .addSubcommand((s: any) => s.setName("reduceri").setDescription("Opreste alertele de reduceri")),
    new SlashCommandBuilder()
      .setName("set")
      .setDescription("Configureaza preferintele serverului (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand((s: any) => s.setName("mode").setDescription("Mod afisare embed")
        .addStringOption((o: any) => o.setName("value").setDescription("compact sau detailed").setRequired(true)
          .addChoices({ name: "compact", value: "compact" }, { name: "detailed", value: "detailed" })))
      .addSubcommand((s: any) => s.setName("mindiscount").setDescription("Procent minim reducere (0-100)")
        .addIntegerOption((o: any) => o.setName("value").setDescription("0-100").setRequired(true).setMinValue(0).setMaxValue(100)))
      .addSubcommand((s: any) => s.setName("maxprice").setDescription("Pret maxim absolut pentru oferte (0 = fara limita)")
        .addIntegerOption((o: any) => o.setName("value").setDescription("0-10000 (0 = dezactivat)").setRequired(true).setMinValue(0).setMaxValue(10000)))
      .addSubcommand((s: any) => s.setName("free").setDescription("Afiseaza jocurile gratuite?")
        .addStringOption((o: any) => o.setName("value").setDescription("on/off").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand((s: any) => s.setName("paid").setDescription("Afiseaza ofertele platite?")
        .addStringOption((o: any) => o.setName("value").setDescription("on/off").setRequired(true)
          .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })))
      .addSubcommand((s: any) => s.setName("currency").setDescription("Valuta pentru afisarea preturilor")
        .addStringOption((o: any) => o.setName("value").setDescription("USD/EUR/GBP/RON").setRequired(true)
          .addChoices(...CURRENCY_CHOICES)))
      .addSubcommand((s: any) => s.setName("stores").setDescription("Filtreaza dupa magazin (steam,epic sau reset)")
        .addStringOption((o: any) => o.setName("value").setDescription("Ex: steam,epic | reset").setRequired(true)))
      .addSubcommandGroup((g: any) => g.setName("games").setDescription("Filtru per-joc pentru update-uri")
        .addSubcommand((s: any) => s.setName("add").setDescription("Adauga un joc la lista activa")
          .addStringOption((o: any) => o.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
        .addSubcommand((s: any) => s.setName("remove").setDescription("Scoate un joc din lista activa")
          .addStringOption((o: any) => o.setName("joc").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
        .addSubcommand((s: any) => s.setName("reset").setDescription("Resetare filtru (toate jocurile active)"))
        .addSubcommand((s: any) => s.setName("list").setDescription("Afiseaza jocurile active explicit")))
      .addSubcommandGroup((g: any) => g.setName("role").setDescription("Roluri ping pentru notificari")
        .addSubcommand((s: any) => s.setName("updates").setDescription("Rol pingat la update-uri (gol = oprit)")
          .addRoleOption((o: any) => o.setName("value").setDescription("Rolul de mentionat (gol = oprit)").setRequired(false)))
        .addSubcommand((s: any) => s.setName("discounts").setDescription("Rol pingat la reduceri (gol = oprit)")
          .addRoleOption((o: any) => o.setName("value").setDescription("Rolul de mentionat (gol = oprit)").setRequired(false)))),
    new SlashCommandBuilder()
      .setName("latest")
      .setDescription("Comenzi pentru ultimele update-uri/oferte")
      .addSubcommand((s: any) => s.setName("updates").setDescription("Cele mai recente update-uri pentru toate jocurile"))
      .addSubcommand((s: any) => s.setName("reduceri").setDescription("Cele mai bune reduceri actuale"))
      .addSubcommand((s: any) => s.setName("update").setDescription("Ultimul update pentru un joc specific")
        .addStringOption((o: any) => o.setName("joc").setDescription("Numele/porecla jocului").setRequired(true).setAutocomplete(true)))
      .addSubcommand((s: any) => s.setName("pret").setDescription("Cauta pretul curent pe Steam")
        .addStringOption((o: any) => o.setName("joc").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))),
    new SlashCommandBuilder()
      .setName("dlc")
      .setDescription("Cauta DLC-urile pentru un joc pe Steam")
      .addStringOption((o: any) => o.setName("joc").setDescription("Numele jocului").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Verifica status server pentru un joc")
      .addStringOption((o: any) => o.setName("joc").setDescription("Numele/porecla jocului").setRequired(true).setAutocomplete(true))
  ].map(b => b.toJSON());
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
