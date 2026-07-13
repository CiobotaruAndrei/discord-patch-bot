import type { SlashCommandJsonSource, SlashDefinitionTools } from "./slashDefinitionTools.js";

export function buildNotificationCommandDefinitions({ SlashCommandBuilder, PermissionsBitField }: SlashDefinitionTools): SlashCommandJsonSource[] {
  return [
    new SlashCommandBuilder()
      .setName("price-alert")
      .setDescription("Gestioneaza alertele de pret pentru jocuri (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza alertele de pret configurate")),
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
      .setName("start")
      .setDescription("Porneste notificarile automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Porneste update-urile pe acest canal"))
      .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Porneste alertele de reduceri pe acest canal"))
      .addSubcommand(subcommand => subcommand.setName("dlc").setDescription("Configureaza canalul pentru notificarile DLC"))
      .addSubcommand(subcommand => subcommand.setName("player-count").setDescription("Porneste urmarirea player-count pentru un joc")
        .addStringOption(option => option.setName("game").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true))),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Opreste notificarile automate (admin)")
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString())
      .addSubcommand(subcommand => subcommand.setName("updates").setDescription("Opreste update-urile"))
      .addSubcommand(subcommand => subcommand.setName("reduceri").setDescription("Opreste alertele de reduceri"))
      .addSubcommand(subcommand => subcommand.setName("dlc").setDescription("Opreste notificarile DLC"))
      .addSubcommand(subcommand => subcommand.setName("player-count").setDescription("Opreste urmarirea player-count pentru un joc")
        .addStringOption(option => option.setName("game").setDescription("Cheia jocului").setRequired(true).setAutocomplete(true)))
  ];
}
