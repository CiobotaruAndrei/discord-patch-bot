import type { AlwaysReplies, BaseChatInputInteraction, StringOption } from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { createAdProtectionRepository } from "../command-security/adProtectionRepository.js";
import type { AdAttemptModelLike, AdRequestModelLike } from "../command-security/adProtectionRepository.js";
import { adFingerprint, detectAd, extractInvite, extractLink, quoteUntrusted } from "../command-security/adRequestTypes.js";
import { adAttemptLines, adRequestButtons, adRequestLines } from "../command-presentation/adProtectionMessages.js";
import { sendTextPages } from "../command-presentation/textPagination.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type Channel = { send?: (payload: unknown) => Promise<unknown> };
type Guild = {
  id: string;
  ownerId?: string;
  channels?: { fetch?: (id: string) => Promise<Channel | null> };
};

type Interaction = BaseChatInputInteraction<Guild> & AlwaysReplies & {
  customId?: string;
  user?: { id?: string } | null;
  isButton?: () => boolean;
  update?: (payload: unknown) => Promise<unknown>;
  options?: StringOption & {
    getSubcommand?: (required?: boolean) => string | null;
    getUser?: (name: string, required?: boolean) => { id?: string } | null;
    getAttachment?: (name: string, required?: boolean) => { url?: string } | null;
  };
};

type Deps = {
  AdRequestModel: AdRequestModelLike;
  AdAttemptModel: AdAttemptModelLike;
  getGuildSettings: (guildId: string) => Promise<{ adAlertChannelId?: string | null; adProtectionEnabled?: boolean } | null>;
};

const NEWLINE = String.fromCharCode(10);
const AD_COMMANDS = new Set(["ad-request", "ad-permissions", "ad-attempts"]);

function newRequestId(): string {
  return `ad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isAdInteraction(interaction: Interaction): boolean {
  if (interaction?.isButton?.() === true) return (interaction.customId ?? "").startsWith("ad-request:");
  return interaction?.isChatInputCommand?.() === true && AD_COMMANDS.has(interaction.commandName ?? "");
}

function isOwner(interaction: Interaction): boolean {
  return Boolean(interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user?.id);
}

function buildCommandHandler(deps: Deps): CommandHandler<Interaction> {
  const repository = createAdProtectionRepository(deps.AdRequestModel, deps.AdAttemptModel);

  async function createRequest(interaction: Interaction, guild: Guild, requesterId: string): Promise<unknown> {
    const adText = (interaction.options?.getString?.("reclama", true) ?? "").trim();
    if (adText.length < 3) {
      return interaction.reply({ content: "Textul reclamei este prea scurt.", ephemeral: true });
    }

    const settings = await deps.getGuildSettings(guild.id).catch(() => null);
    if (settings?.adProtectionEnabled !== true) {
      return interaction.reply({
        content: "Protectia impotriva reclamelor nu este pornita pe acest server, deci nu e nevoie de aprobare.",
        ephemeral: true
      });
    }
    const channelId = settings.adAlertChannelId;
    if (!channelId) {
      return interaction.reply({
        content: "Canalul pentru reclame nu este configurat. Un admin trebuie sa ruleze `/set ad-alert-channel`.",
        ephemeral: true
      });
    }

    const attachmentUrl = interaction.options?.getAttachment?.("atasament", false)?.url ?? null;
    const detection = detectAd(adText, attachmentUrl ? 1 : 0);
    const requestId = newRequestId();
    const record = await repository.createRequest({
      requestId,
      guildId: guild.id,
      requesterId,
      adText,
      fingerprint: adFingerprint(adText, attachmentUrl),
      link: extractLink(adText),
      invite: extractInvite(adText),
      attachmentUrl,
      target: detection.reasons[0] ?? null
    });
    if (!record) {
      return interaction.reply({ content: "Nu am putut salva cererea. Reincearca.", ephemeral: true });
    }

    const channel = await guild.channels?.fetch?.(channelId).catch(() => null);
    const delivered = channel?.send
      ? await channel.send({
        content: [
          `<@${guild.ownerId ?? ""}> cerere noua de reclama de la <@${requesterId}> (\`${requesterId}\`)`,
          attachmentUrl ? `Atasament: ${attachmentUrl}` : "Atasament: niciunul",
          "Textul reclamei:",
          quoteUntrusted(adText)
        ].join(NEWLINE),
        components: adRequestButtons(requestId),
        allowedMentions: { parse: [], users: guild.ownerId ? [guild.ownerId] : [] }
      }).then(() => true).catch(() => false)
      : false;

    if (!delivered) {
      await repository.cancelRequest(guild.id, requestId).catch(() => null);
      return interaction.reply({
        content: "Nu am putut livra cererea in canalul de reclame; cererea a fost anulata. Reincearca.",
        ephemeral: true
      });
    }
    return interaction.reply({ content: "Cererea de reclama a fost trimisa proprietarului serverului.", ephemeral: true });
  }

  async function decide(interaction: Interaction, guild: Guild, approve: boolean, requestId: string): Promise<unknown> {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: "Doar proprietarul serverului poate decide cererile de reclama.", ephemeral: true });
    }
    const ownerId = interaction.user?.id ?? "";
    const resolved = await repository.resolveRequest(guild.id, requestId, approve ? "approved" : "rejected", ownerId);
    if (!resolved) {
      return interaction.reply({ content: "Cererea nu mai este in asteptare (a expirat, a fost anulata sau deja decisa).", ephemeral: true });
    }
    const update = interaction.update ?? interaction.reply;
    return update.call(interaction, {
      content: approve
        ? `Aprobata de <@${ownerId}>. Aprobarea e valabila doar pentru aceasta reclama si acest utilizator, se foloseste o singura data si expira.`
        : `Respinsa de <@${ownerId}>.`,
      components: []
    });
  }

  async function listRequests(interaction: Interaction, guild: Guild): Promise<unknown> {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: "Doar proprietarul serverului poate vedea cererile de reclama.", ephemeral: true });
    }
    const records = await repository.listRequests(guild.id);
    return sendTextPages(interaction, adRequestLines(records), "Nu exista cereri de reclama pentru acest server.", true);
  }

  async function listAttempts(interaction: Interaction, guild: Guild): Promise<unknown> {
    const target = interaction.options?.getUser?.("utilizator", true);
    if (!target?.id) return interaction.reply({ content: "Alege un membru valid.", ephemeral: true });
    const record = await repository.readAttempts(guild.id, target.id);
    return sendTextPages(interaction, adAttemptLines(target.id, record), "Nu exista tentative de afisat.", true);
  }

  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    const actorId = interaction.user?.id;
    if (!guild || !actorId) {
      return interaction.reply({ content: "Comanda este disponibila doar pe server.", ephemeral: true });
    }

    if (interaction.isButton?.() === true) {
      const match = /^ad-request:(approve|reject):(.+)$/.exec(interaction.customId ?? "");
      if (!match) return undefined;
      return decide(interaction, guild, match[1] === "approve", match[2]);
    }

    if (interaction.commandName === "ad-permissions") return listRequests(interaction, guild);
    if (interaction.commandName === "ad-attempts") return listAttempts(interaction, guild);
    return createRequest(interaction, guild, actorId);
  }

  return {
    canHandle: (interaction: unknown): interaction is Interaction => isAdInteraction(interaction as Interaction),
    handle
  };
}

export default { buildCommandHandler };

export const AD_PROTECTION_HANDLER_KEYS = ["AdRequestModel", "AdAttemptModel", "getGuildSettings"] as const;

type AdKeyCheckDeps = Parameters<typeof buildCommandHandler>[0];
type AdMissing = MissingDependencyKeys<AdKeyCheckDeps, (typeof AD_PROTECTION_HANDLER_KEYS)[number] & string>;
type AdExtra = ExtraDependencyKeys<AdKeyCheckDeps, (typeof AD_PROTECTION_HANDLER_KEYS)[number] & string>;
const adProtectionKeysComplete: ExactDependencyKeys<AdMissing, AdExtra> = true;
