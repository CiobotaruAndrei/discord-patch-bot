import type { AlwaysReplies, BaseChatInputInteraction, StringOption } from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { createRaidIncidentRepository } from "../command-security/antiRaidIncidentRepository.js";
import type { RaidIncidentModelLike } from "../command-security/antiRaidIncidentRepository.js";
import { readThresholds } from "../command-security/antiRaidThresholds.js";
import { participantLines, statusLines } from "../command-presentation/antiRaidMessages.js";
import { sendTextPages } from "../command-presentation/textPagination.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type Guild = { id: string; ownerId?: string };

type Interaction = BaseChatInputInteraction<Guild> & AlwaysReplies & {
  user?: { id?: string } | null;
  options?: StringOption & {
    getSubcommand?: (required?: boolean) => string | null;
    getUser?: (name: string, required?: boolean) => { id?: string; bot?: boolean } | null;
    getBoolean?: (name: string, required?: boolean) => boolean | null;
  };
};

type Deps = {
  RaidIncidentModel: RaidIncidentModelLike;
  getGuildSettings: (guildId: string) => Promise<{ antiRaidThresholds?: Record<string, unknown> | null } | null>;
};

const OWNER_ONLY_SUBCOMMANDS = ["force-start", "force-stop", "participant-add", "participant-remove"];

function isAntiRaidInteraction(interaction: Interaction): boolean {
  return interaction?.isChatInputCommand?.() === true && interaction.commandName === "anti-raid";
}

function buildCommandHandler(deps: Deps): CommandHandler<Interaction> {
  const incidents = createRaidIncidentRepository(deps.RaidIncidentModel);

  async function thresholdsFor(guildId: string) {
    const settings = await deps.getGuildSettings(guildId).catch(() => null);
    return readThresholds(settings?.antiRaidThresholds);
  }

  async function showStatus(interaction: Interaction, guild: Guild): Promise<unknown> {
    const incident = await incidents.active(guild.id) ?? await incidents.latest(guild.id);
    const thresholds = await thresholdsFor(guild.id);
    return sendTextPages(
      interaction,
      statusLines(incident, thresholds.safetyPeriodMs, Date.now()),
      "Nu exista niciun incident anti-raid pentru acest server.",
      true
    );
  }

  async function showParticipants(interaction: Interaction, guild: Guild): Promise<unknown> {
    const requestedId = interaction.options?.getString?.("incident-id", false)?.trim();
    const incident = requestedId
      ? await incidents.read(requestedId)
      : await incidents.active(guild.id) ?? await incidents.latest(guild.id);

    if (requestedId && incident && incident.guildId !== guild.id) {
      return interaction.reply({ content: "Incidentul cerut apartine altui server.", ephemeral: true });
    }
    return sendTextPages(
      interaction,
      incident ? participantLines(incident) : [],
      "Nu exista participanti de afisat pentru incidentul cerut.",
      true
    );
  }

  async function forceStart(interaction: Interaction, guild: Guild): Promise<unknown> {
    const existing = await incidents.active(guild.id);
    if (existing) {
      return interaction.reply({
        content: `Exista deja un incident activ: \`${existing._id}\` (etapa ${existing.stage}). Foloseste \`/anti-raid status\`.`,
        ephemeral: true
      });
    }
    const incident = await incidents.open({
      guildId: guild.id,
      triggerReason: "confirmat manual de owner prin /anti-raid force-start",
      manual: true,
      stage: "confirmed"
    });
    return interaction.reply({
      content: incident
        ? `Raid confirmat manual. Incident \`${incident._id}\`; interventia porneste imediat.`
        : "Nu am putut porni incidentul. Reincearca.",
      ephemeral: true
    });
  }

  async function forceStop(interaction: Interaction, guild: Guild): Promise<unknown> {
    if (interaction.options?.getBoolean?.("confirm", true) !== true) {
      return interaction.reply({ content: "Trebuie sa confirmi cu `confirm:true`.", ephemeral: true });
    }
    const incident = await incidents.active(guild.id);
    if (!incident) {
      return interaction.reply({ content: "Nu exista niciun incident activ de incheiat.", ephemeral: true });
    }
    if (incident.stage === "suspected") {
      return interaction.reply({
        content: "Comanda se poate folosi numai dupa un raid confirmat. Incidentul curent este doar suspectat.",
        ephemeral: true
      });
    }
    const moved = await incidents.advance(incident._id, incident.stage, "recovery");
    return interaction.reply({
      content: moved
        ? `Interventia pentru \`${incident._id}\` a fost incheiata. Restaurarea controlata porneste; sanctiunile aplicate raman.`
        : `Incidentul \`${incident._id}\` este deja in restaurare sau inchis.`,
      ephemeral: true
    });
  }

  async function addParticipant(interaction: Interaction, guild: Guild): Promise<unknown> {
    const target = interaction.options?.getUser?.("utilizator", true);
    if (!target?.id) return interaction.reply({ content: "Alege un membru valid.", ephemeral: true });

    const incident = await incidents.active(guild.id);
    if (!incident) return interaction.reply({ content: "Nu exista niciun incident activ.", ephemeral: true });
    if (guild.ownerId && target.id === guild.ownerId) {
      return interaction.reply({ content: "Proprietarul serverului nu poate fi adaugat ca participant.", ephemeral: true });
    }

    const added = await incidents.addParticipant(incident._id, target.id, target.bot === true);
    return interaction.reply({
      content: added
        ? `<@${target.id}> a fost adaugat in incidentul \`${incident._id}\` si intra in fluxul Mute 24h -> Timeout 24h -> Ban.`
        : `<@${target.id}> era deja in incidentul \`${incident._id}\`.`,
      ephemeral: true
    });
  }

  async function removeParticipant(interaction: Interaction, guild: Guild): Promise<unknown> {
    const target = interaction.options?.getUser?.("utilizator", true);
    if (!target?.id) return interaction.reply({ content: "Alege un membru valid.", ephemeral: true });

    const incident = await incidents.active(guild.id);
    if (!incident) return interaction.reply({ content: "Nu exista niciun incident activ.", ephemeral: true });

    const participant = incident.participants.find(entry => entry.userId === target.id);
    if (!participant) {
      return interaction.reply({ content: `<@${target.id}> nu figureaza in incidentul \`${incident._id}\`.`, ephemeral: true });
    }

    await incidents.removeParticipant(incident._id, target.id);
    const applied = participant.appliedSteps.length > 0 ? participant.appliedSteps.join(", ") : "niciuna";
    return interaction.reply({
      content: `<@${target.id}> a fost scos din incidentul \`${incident._id}\`. Sanctiunile deja aplicate (${applied}) NU au fost anulate automat.`,
      ephemeral: true
    });
  }

  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    const actorId = interaction.user?.id;
    if (!guild || !actorId) {
      return interaction.reply({ content: "Comanda este disponibila doar pe server.", ephemeral: true });
    }

    const subcommand = interaction.options?.getSubcommand?.() ?? "status";
    if (OWNER_ONLY_SUBCOMMANDS.includes(subcommand) && guild.ownerId !== actorId) {
      return interaction.reply({ content: "Doar proprietarul serverului poate folosi aceasta subcomanda.", ephemeral: true });
    }

    if (subcommand === "participant-list") return showParticipants(interaction, guild);
    if (subcommand === "force-start") return forceStart(interaction, guild);
    if (subcommand === "force-stop") return forceStop(interaction, guild);
    if (subcommand === "participant-add") return addParticipant(interaction, guild);
    if (subcommand === "participant-remove") return removeParticipant(interaction, guild);
    return showStatus(interaction, guild);
  }

  return {
    canHandle: (interaction: unknown): interaction is Interaction => isAntiRaidInteraction(interaction as Interaction),
    handle
  };
}

export default { buildCommandHandler };

export const ANTI_RAID_HANDLER_KEYS = ["RaidIncidentModel", "getGuildSettings"] as const;

type AntiRaidKeyCheckDeps = Parameters<typeof buildCommandHandler>[0];
type AntiRaidMissing = MissingDependencyKeys<AntiRaidKeyCheckDeps, (typeof ANTI_RAID_HANDLER_KEYS)[number] & string>;
type AntiRaidExtra = ExtraDependencyKeys<AntiRaidKeyCheckDeps, (typeof ANTI_RAID_HANDLER_KEYS)[number] & string>;
const antiRaidKeysComplete: ExactDependencyKeys<AntiRaidMissing, AntiRaidExtra> = true;
