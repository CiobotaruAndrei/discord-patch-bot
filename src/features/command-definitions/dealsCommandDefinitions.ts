import type { SlashCommandJsonSource, SlashDefinitionTools } from "./slashDefinitionTools.js";

export function buildDealsCommandDefinitions({ SlashCommandBuilder, CURRENCY_CHOICES }: SlashDefinitionTools): SlashCommandJsonSource[] {
  return [
    new SlashCommandBuilder()
      .setName("price-check")
      .setDescription("Compara pretul Steam al unui joc cu sursele externe de reduceri")
      .addStringOption(option => option.setName("joc").setDescription("Numele jocului").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder()
      .setName("deal-score")
      .setDescription("Calculeaza cat de buna este oferta activa a unui joc")
      .addStringOption(option => option.setName("game").setDescription("Numele jocului").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder()
      .setName("best")
      .setDescription("Cauta cele mai bune oferte sub un buget")
      .addSubcommandGroup(group => group.setName("deals").setDescription("Cautari in ofertele curente")
        .addSubcommand(subcommand => subcommand.setName("under").setDescription("Cele mai bune oferte sub bugetul ales")
          .addNumberOption(option => option.setName("buget").setDescription("Bugetul maxim").setRequired(true).setMinValue(0.01).setMaxValue(100000))
          .addStringOption(option => option.setName("currency").setDescription("Valuta").setRequired(false).addChoices(...CURRENCY_CHOICES))
          .addIntegerOption(option => option.setName("numar").setDescription("Cate rezultate (1-10, implicit 5)").setRequired(false).setMinValue(1).setMaxValue(10)))),
    new SlashCommandBuilder()
      .setName("ending")
      .setDescription("Afiseaza oferte care expira in curand")
      .addSubcommand(subcommand => subcommand.setName("deals").setDescription("Oferte cu termen de expirare detectat")
        .addStringOption(option => option.setName("currency").setDescription("Valuta").setRequired(false).addChoices(...CURRENCY_CHOICES))
        .addIntegerOption(option => option.setName("numar").setDescription("Cate rezultate (1-10, implicit 5)").setRequired(false).setMinValue(1).setMaxValue(10)))
  ];
}
