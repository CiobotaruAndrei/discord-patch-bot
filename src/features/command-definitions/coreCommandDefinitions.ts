import type { SlashCommandJsonSource, SlashDefinitionTools } from "./slashDefinitionTools.js";
import { REPORT_TYPES } from "../feedback/reportTypes.js";

export function buildCoreCommandDefinitions({ SlashCommandBuilder, PermissionsBitField }: SlashDefinitionTools): SlashCommandJsonSource[] {
  return [
    new SlashCommandBuilder().setName("ping").setDescription("Verifica daca botul raspunde"),
    new SlashCommandBuilder().setName("games").setDescription("Listeaza jocurile urmarite (poreclele acceptate)"),
    new SlashCommandBuilder().setName("help").setDescription("Afiseaza meniul de ajutor")
      .addStringOption(option => option.setName("command").setDescription("Comanda pentru explicatie detaliata").setRequired(false).setAutocomplete(true)),
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
  ];
}
