import type { SlashCommandJsonSource, SlashDefinitionTools } from "./slashDefinitionTools.js";

export function buildGameInfoCommandDefinitions({ SlashCommandBuilder, CURRENCY_CHOICES }: SlashDefinitionTools): SlashCommandJsonSource[] {
  return [
    new SlashCommandBuilder()
      .setName("review-trend")
      .setDescription("Afiseaza semnalul curent de review-uri pentru un joc")
      .addSubcommand(subcommand => subcommand.setName("game").setDescription("Review trend pentru joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("crossplay")
      .setDescription("Verifica semnalele Steam pentru crossplay si cross-save")
      .addSubcommand(subcommand => subcommand.setName("game").setDescription("Crossplay pentru joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("platforms")
      .setDescription("Afiseaza platformele si magazinele detectate pentru un joc")
      .addSubcommand(subcommand => subcommand.setName("game").setDescription("Platforme pentru joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("co-op")
      .setDescription("Afiseaza modurile co-op/multiplayer detectate pentru un joc")
      .addSubcommand(subcommand => subcommand.setName("game").setDescription("Moduri co-op pentru joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("system")
      .setDescription("Afiseaza cerinte de sistem")
      .addSubcommandGroup(group => group.setName("requirements").setDescription("Cerinte de sistem")
        .addSubcommand(subcommand => subcommand.setName("game").setDescription("Cerinte de sistem pentru joc")
          .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
          .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES)))),
    new SlashCommandBuilder()
      .setName("game-size")
      .setDescription("Afiseaza dimensiunea aproximativa de instalare")
      .addSubcommand(subcommand => subcommand.setName("game").setDescription("Dimensiune instalare pentru joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("player-count")
      .setDescription("Afiseaza numarul curent de jucatori activi pe Steam")
      .addSubcommand(subcommand => subcommand.setName("game").setDescription("Player-count pentru un joc")
        .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName("currency").setDescription("Valuta pentru cautarea Steam").setRequired(false).addChoices(...CURRENCY_CHOICES))),
    new SlashCommandBuilder()
      .setName("top")
      .setDescription("Afiseaza topuri operationale din sursele botului")
      .addSubcommandGroup(group => group.setName("active").setDescription("Topuri dupa activitate")
        .addSubcommand(subcommand => subcommand.setName("games").setDescription("Top jocuri active dupa player-count Steam")
          .addIntegerOption(option => option.setName("numar").setDescription("Cate rezultate (1-10, implicit 5)").setRequired(false).setMinValue(1).setMaxValue(10)))),
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
  ];
}
