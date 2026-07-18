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
      .setDescription("Propune o comanda noua pentru bot")
      .addStringOption(option => option.setName("name").setDescription("Numele comenzii propuse").setRequired(true).setMaxLength(80))
      .addStringOption(option => option.setName("description").setDescription("Ce ar trebui sa faca aceasta comanda").setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Listeaza resurse administrative")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(subcommand => subcommand.setName("suggest-command").setDescription("Listeaza comenzile sugerate")
        .addIntegerOption(option => option.setName("numar").setDescription("Cate sugestii (1-25, implicit 10)").setRequired(false).setMinValue(1).setMaxValue(25))),
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
      .setName("report")
      .setDescription("Raporteaza buguri sau reclamatii si gestioneaza listele")
      .setDMPermission(false)
      .addSubcommand(subcommand => subcommand.setName("bug").setDescription("Raporteaza o problema de functionare")
        .addStringOption(option => option.setName("tip").setDescription("Tipul problemei").setRequired(true)
          .addChoices(...REPORT_TYPES.map(type => ({ name: type.label, value: type.value }))))
        .addStringOption(option => option.setName("joc").setDescription("Jocul asociat").setRequired(true).setAutocomplete(true)))
      .addSubcommand(subcommand => subcommand.setName("complaint").setDescription("Reclama un membru al serverului")
        .addUserOption(option => option.setName("target").setDescription("Membrul reclamat").setRequired(true)))
      .addSubcommandGroup(group => group.setName("list").setDescription("Liste administrative")
        .addSubcommand(subcommand => subcommand.setName("bugs").setDescription("Listeaza rapoartele de bug"))
        .addSubcommand(subcommand => subcommand.setName("users").setDescription("Listeaza reclamatiile impotriva membrilor")))
      .addSubcommandGroup(group => group.setName("remove").setDescription("Stergere administrativa")
        .addSubcommand(subcommand => subcommand.setName("bug").setDescription("Sterge un raport de bug")
          .addStringOption(option => option.setName("id").setDescription("ID-ul raportului de bug").setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName("user").setDescription("Sterge o reclamatie impotriva unui membru")
          .addStringOption(option => option.setName("id").setDescription("ID-ul reclamatiei").setRequired(true)))),
    new SlashCommandBuilder()
      .setName("health")
      .setDescription("Starea botului: Discord, MongoDB, cache, uptime")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
  ];
}
