import { validateRestrictionIsSubset } from "../command-security/approvalSubsetPolicy.js";

import type { AlwaysReplies, BaseChatInputInteraction, StringOption } from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { createPermissionRequestRepository } from "../command-security/permissionRequestRepository.js";
import type { PermissionRequestModelLike } from "../command-security/permissionRequestRepository.js";
import { appliesToType, isPermissionRequestStatus, isPermissionRequestType } from "../command-security/permissionRequestTypes.js";
import type { PermissionRequestRecord, PermissionRequestStatus, PermissionRequestType } from "../command-security/permissionRequestTypes.js";
import {
  RESTRICTION_INPUT_IDS,
  parseDurationMs,
  parsePermissionList,
  restrictionFromModal,
  compareRequestedApproved
} from "../command-security/permissionRequestApproval.js";
import {
  displayPermissionRequest,
  orderPermissionRequests,
  permissionRequestButtons
} from "../command-presentation/permissionRequestMessages.js";
import { validatePermissionRequest } from "../command-security/permissionRequestValidation.js";
import { sendTextPages } from "../command-presentation/textPagination.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

type Channel = { send?: (payload: unknown) => Promise<unknown> };
type RequesterMember = { send?: (payload: unknown) => Promise<unknown> };
type Guild = {
  id: string;
  ownerId?: string;
  channels?: { fetch?: (id: string) => Promise<Channel | null> };
  members?: { fetch?: (id: string) => Promise<RequesterMember | null> };
};

type ModalSubmission = {
  customId?: string;
  user?: { id?: string } | null;
  fields?: { getTextInputValue?: (id: string) => string };
  reply?: (payload: { content: string; ephemeral: boolean }) => Promise<unknown>;
};

type Interaction = BaseChatInputInteraction<Guild> & AlwaysReplies & {
  customId?: string;
  user?: { id?: string; username?: string } | null;
  options?: StringOption & {
    getInteger?: (name: string, required?: boolean) => number | null;
  };
  isButton?: () => boolean;
  update?: (payload: unknown) => Promise<unknown>;
  showModal?: (modal: unknown) => Promise<unknown>;
  awaitModalSubmit?: (options: { time: number; filter: (submission: ModalSubmission) => boolean }) => Promise<ModalSubmission | null>;
};

type Deps = {
  PermissionRequestModel: PermissionRequestModelLike;
  getGuildSettings: (guildId: string) => Promise<{ permissionRequestChannelId?: string | null } | null>;
};

const MODAL_TIMEOUT_MS = 5 * 60 * 1000;

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOwner(interaction: Interaction): boolean {
  return Boolean(interaction.guild?.ownerId && interaction.guild.ownerId === interaction.user?.id);
}

export function restrictionModal(record: PermissionRequestRecord, customId: string): unknown {
  const optional = [
    { field: "amount" as const, id: RESTRICTION_INPUT_IDS.amount, label: "Cantitate maxima (gol = cea ceruta)", value: record.amount != null ? String(record.amount) : "" },
    { field: "permissions" as const, id: RESTRICTION_INPUT_IDS.permissions, label: "Permisiuni (gol = cele cerute)", value: (record.permissions ?? []).join(", ") },
    { field: "botId" as const, id: RESTRICTION_INPUT_IDS.botId, label: "Bot executor (gol = cel cerut)", value: record.botId ?? "" }
  ].filter(entry => appliesToType(record.type, entry.field));

  const rows = [
    { id: RESTRICTION_INPUT_IDS.target, label: "Tinta aprobata", value: record.target ?? "", required: true },
    { id: RESTRICTION_INPUT_IDS.action, label: "Actiunea aprobata", value: record.action ?? "", required: true },
    ...optional.map(entry => ({ id: entry.id, label: entry.label, value: entry.value, required: false })),
    { id: RESTRICTION_INPUT_IDS.duration, label: "Valabilitate (ex. 30m, 2h, 1d)", value: "1h", required: false }
  ];
  return {
    custom_id: customId,
    title: "Aproba cererea (poti restrange)",
    components: rows.map(row => ({
      type: 1,
      components: [{
        type: 4,
        custom_id: row.id,
        label: row.label.slice(0, 45),
        style: 1,
        required: row.required,
        value: row.value.slice(0, 100),
        max_length: 100
      }]
    }))
  };
}

function isPermissionRequestInteraction(interaction: Interaction): boolean {
  if (interaction?.isButton?.() === true) {
    return typeof interaction.customId === "string" && interaction.customId.startsWith("permission-request:");
  }
  if (interaction?.isChatInputCommand?.() !== true || !interaction.guild) return false;
  return interaction.commandName === "permission-request" || interaction.commandName === "permission-requests";
}

export function buildCommandHandler(deps: Deps): CommandHandler<Interaction> {
  const repository = createPermissionRequestRepository(deps.PermissionRequestModel);

  async function decide(interaction: Interaction, guild: Guild, decision: "approve" | "reject", requestId: string): Promise<unknown> {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: "Doar proprietarul serverului poate decide cererile de securitate.", ephemeral: true });
    }
    const ownerId = interaction.user?.id ?? "";
    const pending = await repository.read(guild.id, requestId);
    if (!pending || pending.status !== "pending") {
      const notice = "Cererea nu mai este activa sau a expirat.";
      return interaction.update ? interaction.update({ content: notice, components: [] }) : interaction.reply({ content: notice, ephemeral: true });
    }

    let restriction = {};
    if (decision === "approve" && interaction.showModal && interaction.awaitModalSubmit) {
      const modalId = `permission-request-modal:${requestId}:${Date.now().toString(36)}`;
      await interaction.showModal(restrictionModal(pending, modalId));
      const submission = await interaction.awaitModalSubmit({
        time: MODAL_TIMEOUT_MS,
        filter: entry => entry.customId === modalId && entry.user?.id === ownerId
      }).catch(() => null);
      if (!submission) return undefined;
      const read = (id: string): string => submission.fields?.getTextInputValue?.(id) ?? "";
      restriction = restrictionFromModal(pending, {
        target: read(RESTRICTION_INPUT_IDS.target),
        action: read(RESTRICTION_INPUT_IDS.action),
        amount: read(RESTRICTION_INPUT_IDS.amount),
        permissions: read(RESTRICTION_INPUT_IDS.permissions),
        botId: read(RESTRICTION_INPUT_IDS.botId),
        duration: read(RESTRICTION_INPUT_IDS.duration)
      });

      const verdict = validateRestrictionIsSubset(pending, restriction);
      if (!verdict.ok) {
        return submission.reply
          ? submission.reply({ content: `Aprobarea nu a fost aplicata. ${verdict.problem}`, ephemeral: true })
          : undefined;
      }
      restriction = verdict.restriction;
    }

    const record = await repository.resolve(guild.id, requestId, decision === "approve" ? "approved" : "rejected", ownerId, restriction);
    if (!record) {
      const notice = "Cererea nu mai este activa sau a expirat.";
      return interaction.update ? interaction.update({ content: notice, components: [] }) : interaction.reply({ content: notice, ephemeral: true });
    }

    const decided = decision === "approve" ? "Aprobata" : "Respinsa";
    const requesterNotice = decision === "approve"
      ? "cererea ta de securitate a fost aprobata; ai o singura fereastra pentru operatiunea aprobata."
      : "cererea ta de securitate a fost respinsa de owner.";
    const requester = guild.members?.fetch ? await guild.members.fetch(record.requesterId).catch(() => null) : null;
    const delivered = requester?.send
      ? await requester.send({ content: requesterNotice, allowedMentions: { parse: [] } }).then(() => true).catch(() => false)
      : false;
    const comparison = decision === "approve" ? compareRequestedApproved(record) + String.fromCharCode(10) : "";
    const content = `${decided}: ${displayPermissionRequest(record)}\n${comparison}<@${record.requesterId}> ${requesterNotice}\n`
      + (delivered ? "Notificare directa trimisa solicitantului." : "Notificarea directa nu a putut fi livrata; decizia ramane in acest canal.");
    const allowedMentions = { parse: [], users: [record.requesterId] };
    return interaction.update
      ? interaction.update({ content, components: [], allowedMentions })
      : interaction.reply({ content, ephemeral: true, allowedMentions });
  }

  async function listRequests(interaction: Interaction, guild: Guild): Promise<unknown> {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: "Doar proprietarul serverului poate vedea lista cererilor de securitate.", ephemeral: true });
    }
    const statusOption = interaction.options?.getString("status", false)?.trim();
    const typeOption = interaction.options?.getString("type", false)?.trim();
    const filters: { status?: PermissionRequestStatus; type?: PermissionRequestType } = {};
    if (isPermissionRequestStatus(statusOption)) filters.status = statusOption;
    if (isPermissionRequestType(typeOption)) filters.type = typeOption;
    const records = await repository.list(guild.id, filters, 200);
    const ordered = orderPermissionRequests(records, Date.now());
    return sendTextPages(interaction, ordered.map(displayPermissionRequest), "Nu exista cereri de securitate.", true);
  }

  async function createRequest(interaction: Interaction, guild: Guild): Promise<unknown> {
    const typeOption = interaction.options?.getString("type", true)?.trim();
    if (!isPermissionRequestType(typeOption)) {
      return interaction.reply({ content: "Tipul cererii nu este valid.", ephemeral: true });
    }
    const reason = interaction.options?.getString("reason", true)?.trim() ?? "";
    const validation = validatePermissionRequest({
      type: typeOption,
      target: interaction.options?.getString("target", true) ?? "",
      action: interaction.options?.getString("action", true) ?? "",
      reason,
      amount: interaction.options?.getInteger?.("amount", false) ?? null,
      permissions: parsePermissionList(interaction.options?.getString("permissions", false) ?? ""),
      botId: interaction.options?.getString("bot", false) ?? null,
      duration: interaction.options?.getString("duration", false) ?? ""
    });
    if (!validation.ok) {
      return interaction.reply({ content: validation.problem, ephemeral: true });
    }
    const validated = validation.value;

    const settings = await deps.getGuildSettings(guild.id).catch(() => null);
    const channelId = settings?.permissionRequestChannelId;
    const channel = channelId && guild.channels?.fetch ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.send) {
      return interaction.reply({ content: "Canalul de cereri de securitate nu este configurat sau nu este disponibil.", ephemeral: true });
    }

    const requestId = newRequestId();
    const record = await repository.create({
      requestId,
      guildId: guild.id,
      type: typeOption,
      requesterId: interaction.user?.id ?? "",
      target: validated.target,
      action: validated.action,
      amount: validated.amount,
      permissions: validated.permissions,
      botId: validated.botId,
      reason,
      ttlMs: validated.ttlMs
    });
    if (!record) {
      return interaction.reply({ content: "Cererea nu a putut fi salvata. Reincearca.", ephemeral: true });
    }

    try {
      await channel.send({
        content: `${guild.ownerId ? `<@${guild.ownerId}> ` : ""}Cerere de aprobare de securitate: ${displayPermissionRequest(record)}`,
        components: permissionRequestButtons(record._id),
        allowedMentions: guild.ownerId ? { parse: [], users: [guild.ownerId] } : { parse: [] }
      });
    } catch {
      await repository.cancelUndelivered(guild.id, requestId).catch(() => false);
      return interaction.reply({
        content: "Nu am putut livra cererea in canalul de aprobare; cererea a fost anulata. Reincearca.",
        ephemeral: true
      });
    }
    return interaction.reply({ content: "Cererea a fost trimisa proprietarului serverului.", ephemeral: true });
  }

  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    if (!guild || !interaction.user?.id) {
      return interaction.reply({ content: "Comanda este disponibila doar pe server.", ephemeral: true });
    }
    if (interaction.isButton?.() === true) {
      const match = /^permission-request:(approve|reject):(.+)$/.exec(interaction.customId ?? "");
      if (!match) return undefined;
      return decide(interaction, guild, match[1] === "approve" ? "approve" : "reject", match[2]);
    }
    if (interaction.commandName === "permission-requests") return listRequests(interaction, guild);
    return createRequest(interaction, guild);
  }

  return {
    canHandle: (interaction: unknown): interaction is Interaction => isPermissionRequestInteraction(interaction as Interaction),
    handle
  };
}

export default { buildCommandHandler };

export const PERMISSION_REQUEST_HANDLER_KEYS = [
  "PermissionRequestModel",
  "getGuildSettings"
] as const;

type PermissionRequestKeyCheckDeps = Parameters<typeof buildCommandHandler>[0];
type PermissionRequestMissing = MissingDependencyKeys<PermissionRequestKeyCheckDeps, (typeof PERMISSION_REQUEST_HANDLER_KEYS)[number] & string>;
type PermissionRequestExtra = ExtraDependencyKeys<PermissionRequestKeyCheckDeps, (typeof PERMISSION_REQUEST_HANDLER_KEYS)[number] & string>;
const permissionRequestKeysComplete: ExactDependencyKeys<PermissionRequestMissing, PermissionRequestExtra> = true;
