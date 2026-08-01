import type { SlashCommandJsonSource, SlashDefinitionTools } from "./slashDefinitionTools.js";

export function buildModerationCommandDefinitions({ SlashCommandBuilder, PermissionsBitField }: SlashDefinitionTools): SlashCommandJsonSource[] {
  const admin = <T extends { setDefaultMemberPermissions(value: string): T }>(builder: T): T => builder.setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator.toString());
  return [
    admin(new SlashCommandBuilder().setName("timeout").setDescription("Aplica timeout unui utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true)).addStringOption(option => option.setName("durata").setDescription("Durata: 30m, 2h, 1d").setRequired(true).setMaxLength(10)).addStringOption(option => option.setName("motiv").setDescription("Motiv optional").setRequired(false).setMaxLength(500)).addAttachmentOption(option => option.setName("atasament").setDescription("Atasament direct optional").setRequired(false))),
    admin(new SlashCommandBuilder().setName("remove-timeout").setDescription("Elimina timeout-ul unui utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true))),
    new SlashCommandBuilder().setName("timeout-list").setDescription("Afiseaza timeout-urile active").setDMPermission(false),
    admin(new SlashCommandBuilder().setName("mute").setDescription("Aplica mute unui utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true)).addStringOption(option => option.setName("durata").setDescription("Durata: 30m, 2h, 1d").setRequired(true).setMaxLength(10)).addStringOption(option => option.setName("motiv").setDescription("Motiv optional").setRequired(false).setMaxLength(500)).addAttachmentOption(option => option.setName("atasament").setDescription("Atasament direct optional").setRequired(false))),
    admin(new SlashCommandBuilder().setName("unmute").setDescription("Elimina mute-ul unui utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true))),
    new SlashCommandBuilder().setName("mute-list").setDescription("Afiseaza mute-urile active").setDMPermission(false),
    admin(new SlashCommandBuilder().setName("kick").setDescription("Elimina un utilizator de pe server").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true)).addStringOption(option => option.setName("motiv").setDescription("Motiv optional").setRequired(false).setMaxLength(500)).addAttachmentOption(option => option.setName("atasament").setDescription("Atasament direct optional").setRequired(false))),
    admin(new SlashCommandBuilder().setName("ban").setDescription("Baneaza un utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true)).addStringOption(option => option.setName("motiv").setDescription("Motiv optional").setRequired(false).setMaxLength(500)).addAttachmentOption(option => option.setName("atasament").setDescription("Atasament direct optional").setRequired(false))),
    admin(new SlashCommandBuilder().setName("unban").setDescription("Debaneaza un utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true)).addStringOption(option => option.setName("motiv").setDescription("Motiv optional").setRequired(false).setMaxLength(500)).addAttachmentOption(option => option.setName("atasament").setDescription("Atasament direct optional").setRequired(false))),
    admin(new SlashCommandBuilder().setName("warn").setDescription("Avertizeaza un utilizator").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true)).addStringOption(option => option.setName("motiv").setDescription("Motiv optional daca exista atasament").setRequired(false).setMaxLength(500)).addAttachmentOption(option => option.setName("atasament").setDescription("Atasament direct optional").setRequired(false)).addChannelOption(option => option.setName("canal").setDescription("Canalul de warn, necesar la prima configurare").setRequired(false))),
    admin(new SlashCommandBuilder().setName("remove-warn").setDescription("Elimina cel mai recent warn").addUserOption(option => option.setName("utilizator").setDescription("Utilizatorul").setRequired(true))),
    new SlashCommandBuilder().setName("warn-list").setDescription("Afiseaza avertismentele active").setDMPermission(false),
    admin(new SlashCommandBuilder().setName("warn-ban-limit").setDescription("Seteaza limita de warn-uri pentru ban automat").addIntegerOption(option => option.setName("numar").setDescription("Limita pozitiva").setRequired(true).setMinValue(1).setMaxValue(100)))
    ,admin(new SlashCommandBuilder().setName("bot-add-request").setDescription("Solicita aprobarea proprietarului pentru adaugarea unui bot")
      .addStringOption(option => option.setName("bot-id").setDescription("ID-ul botului solicitat").setRequired(true).setMinLength(17).setMaxLength(20)))
    ,admin(new SlashCommandBuilder().setName("bot-add-permissions").setDescription("Afiseaza solicitarile si permisiunile de adaugare boti"))
    ,new SlashCommandBuilder().setName("permission-request").setDescription("Cere aprobarea ownerului pentru o operatiune de securitate").setDMPermission(false)
      .addStringOption(option => option.setName("type").setDescription("Tipul operatiunii").setRequired(true)
        .addChoices(
          { name: "bot-add", value: "bot-add" },
          { name: "permission-grant", value: "permission-grant" },
          { name: "moderation-mass", value: "moderation-mass" },
          { name: "webhook", value: "webhook" },
          { name: "server-structure", value: "server-structure" },
          { name: "protected-resource-change", value: "protected-resource-change" }
        ))
      .addStringOption(option => option.setName("target").setDescription("Resursa vizata (ID bot, rol, canal, membru)").setRequired(true).setMaxLength(120))
      .addStringOption(option => option.setName("action").setDescription("Actiunea ceruta (add, grant, create, delete, rename)").setRequired(true).setMaxLength(60))
      .addStringOption(option => option.setName("reason").setDescription("Motivul cererii").setRequired(true).setMaxLength(500))
      .addIntegerOption(option => option.setName("amount").setDescription("Cantitatea ceruta, unde se aplica").setRequired(false).setMinValue(1).setMaxValue(1000))
      .addStringOption(option => option.setName("permissions").setDescription("Permisiunile cerute, separate prin virgula").setRequired(false).setMaxLength(300))
      .addStringOption(option => option.setName("bot").setDescription("Botul executor, daca exista").setRequired(false).setMaxLength(20))
      .addStringOption(option => option.setName("duration").setDescription("Valabilitatea ceruta (ex. 30m, 2h, 1d)").setRequired(false).setMaxLength(10))
    ,admin(new SlashCommandBuilder().setName("permission-requests").setDescription("Afiseaza cererile de aprobare de securitate")
      .addSubcommand(subcommand => subcommand.setName("list").setDescription("Listeaza cererile de securitate")
        .addStringOption(option => option.setName("status").setDescription("Filtreaza dupa status").setRequired(false)
          .addChoices(
            { name: "pending", value: "pending" },
            { name: "approved", value: "approved" },
            { name: "rejected", value: "rejected" },
            { name: "used", value: "used" },
            { name: "expired", value: "expired" },
            { name: "cancelled", value: "cancelled" }
          ))
        .addStringOption(option => option.setName("type").setDescription("Filtreaza dupa tipul operatiunii").setRequired(false)
          .addChoices(
            { name: "bot-add", value: "bot-add" },
            { name: "permission-grant", value: "permission-grant" },
            { name: "moderation-mass", value: "moderation-mass" },
            { name: "webhook", value: "webhook" },
            { name: "server-structure", value: "server-structure" },
            { name: "protected-resource-change", value: "protected-resource-change" }
          ))))
    ,admin(new SlashCommandBuilder().setName("protected-resource").setDescription("Marcheaza canale, categorii si roluri ca resurse critice")
      .addStringOption(option => option.setName("action").setDescription("Ce faci cu resursa").setRequired(true)
        .addChoices(
          { name: "add", value: "add" },
          { name: "remove", value: "remove" },
          { name: "list", value: "list" }
        ))
      .addStringOption(option => option.setName("type").setDescription("Tipul resursei (necesar la add si remove)").setRequired(false)
        .addChoices(
          { name: "channel", value: "channel" },
          { name: "category", value: "category" },
          { name: "role", value: "role" }
        ))
      .addStringOption(option => option.setName("target").setDescription("ID-ul resursei (necesar la add si remove)").setRequired(false).setMaxLength(20)))
    ,admin(new SlashCommandBuilder().setName("anti-raid").setDescription("Administreaza incidentele anti-raid")
      .addSubcommand(subcommand => subcommand.setName("status").setDescription("Arata incidentul activ: etapa, canale blocate, participanti, sanctiuni si erori"))
      .addSubcommand(subcommand => subcommand.setName("participant-list").setDescription("Listeaza participantii unui incident")
        .addStringOption(option => option.setName("incident-id").setDescription("ID-ul incidentului; implicit cel activ sau ultimul").setRequired(false).setMaxLength(40)))
      .addSubcommand(subcommand => subcommand.setName("force-start").setDescription("Confirma manual un raid si porneste interventia"))
      .addSubcommand(subcommand => subcommand.setName("force-stop").setDescription("Incheie manual interventia si porneste restaurarea controlata")
        .addBooleanOption(option => option.setName("confirm").setDescription("Confirma incheierea interventiei").setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("participant-add").setDescription("Adauga manual un participant omis")
        .addUserOption(option => option.setName("utilizator").setDescription("Membrul de adaugat in incident").setRequired(true)))
      .addSubcommand(subcommand => subcommand.setName("participant-remove").setDescription("Elimina din incident un participant identificat gresit")
        .addUserOption(option => option.setName("utilizator").setDescription("Membrul de scos din incident").setRequired(true))))
  ];
}
