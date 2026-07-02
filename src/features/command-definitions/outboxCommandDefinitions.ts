import type { SlashCommandJsonSource, SlashDefinitionTools } from "./slashDefinitionTools";

export function buildOutboxCommandDefinitions({ SlashCommandBuilder, PermissionsBitField }: SlashDefinitionTools): SlashCommandJsonSource[] {
  return [
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
        .addSubcommand(subcommand => subcommand.setName("status").setDescription("Starea recovery-verify pentru acest server si global")))
  ];
}
