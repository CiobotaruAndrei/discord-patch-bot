import type { AlwaysReplies, BaseChatInputInteraction, StringOption } from "./discordInteractionPorts.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { createProtectedResourceRepository } from "../command-security/protectedResourceRepository.js";
import type { ProtectedResourceModelLike } from "../command-security/protectedResourceRepository.js";
import { captureSnapshot, isProtectedResourceType } from "../command-security/protectedResourceTypes.js";
import type { ProtectedResourceType, ResourceLike } from "../command-security/protectedResourceTypes.js";
import { evaluateProtectionReadiness } from "../command-security/protectedResourceReadiness.js";
import type { GuardCapability, ReadinessInput } from "../command-security/protectedResourceReadiness.js";
import {
  adaptPreventionPort,
  applyChannelPrevention,
  describePrevention,
  memberOverwriteTargets,
  planChannelPrevention,
  preventionGaps,
  preventionHolds,
  restoreChannelPrevention
} from "../command-security/protectedResourcePrevention.js";
import type { PreventableChannel, PreventionOutcome, PreventionTarget, PreviousAccess } from "../command-security/protectedResourcePrevention.js";
import { protectedResourceLines } from "../command-presentation/protectedResourceMessages.js";
import { sendTextPages } from "../command-presentation/textPagination.js";
import type { MissingDependencyKeys, ExtraDependencyKeys, ExactDependencyKeys } from "../../shared/dependencyKeyContract.js";

const CATEGORY_CHANNEL_TYPE = 4;

type RoleLike = ResourceLike & { id: string; position?: unknown; permissions?: unknown };

type Guild = {
  id: string;
  ownerId?: string;
  members?: { me?: unknown; cache?: { get?: (id: string) => unknown }; fetch?: (id: string) => Promise<unknown> };
  channels?: { cache?: { get?: (id: string) => unknown } };
  roles?: { cache?: { get?: (id: string) => unknown; values?: () => Iterable<unknown> } };
};

type Interaction = BaseChatInputInteraction<Guild> & AlwaysReplies & {
  user?: { id?: string } | null;
  options?: StringOption;
};

type Deps = {
  ProtectedResourceModel: ProtectedResourceModelLike;
};

function isProtectedResourceInteraction(interaction: Interaction): boolean {
  return interaction?.isChatInputCommand?.() === true && interaction.commandName === "protected-resource";
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasPermission(holder: unknown, flag: string): boolean {
  const permissions = (holder as { permissions?: { has?: (value: unknown) => boolean } } | null)?.permissions;
  return permissions?.has?.(flag) === true;
}

function readBotCapability(guild: Guild): GuardCapability {
  const me = guild.members?.me;
  const roles = (me as { roles?: { highest?: { position?: unknown } } } | null)?.roles;
  return {
    botHighestRolePosition: numberOf(roles?.highest?.position),
    botCanManageChannels: hasPermission(me, "ManageChannels"),
    botCanManageRoles: hasPermission(me, "ManageRoles"),
    botCanViewAuditLog: hasPermission(me, "ViewAuditLog")
  };
}

function guildRoles(guild: Guild): { id: string; name: string; position: number; administrator: boolean; managesChannels: boolean }[] {
  const values = guild.roles?.cache?.values?.();
  const roles: { id: string; name: string; position: number; administrator: boolean; managesChannels: boolean }[] = [];
  for (const entry of values ?? []) {
    const role = entry as { id?: unknown; name?: unknown; position?: unknown };
    if (typeof role.id !== "string") continue;
    roles.push({
      id: role.id,
      name: typeof role.name === "string" ? role.name : role.id,
      position: numberOf(role.position) ?? 0,
      administrator: hasPermission(role, "Administrator"),
      managesChannels: hasPermission(role, "ManageChannels")
    });
  }
  return roles;
}

function readinessInputFor(
  type: ProtectedResourceType,
  guild: Guild,
  resource: ResourceLike & { id?: string }
): ReadinessInput {
  const roles = guildRoles(guild);
  if (type === "role") {
    const position = numberOf(resource.position) ?? 0;
    const managers = roles.filter(role => role.id !== resource.id && (role.administrator || hasPermission(role, "ManageRoles")));
    return {
      type: "role",
      rolePosition: position,
      rolesBelow: managers.filter(role => role.position < position),
      rolesAbove: managers.filter(role => role.position >= position)
    };
  }
  return {
    type,
    managerRoles: roles.filter(role => role.administrator || role.managesChannels),
    managerMembers: channelManagerMembers(guild, resource)
  };
}

function botOwnRoleIds(guild: Guild): Set<string> {
  const me = guild.members?.me as { id?: unknown; roles?: { cache?: { values?: () => Iterable<unknown> } } } | null;
  const ids = new Set<string>();
  if (typeof me?.id === "string") ids.add(me.id);
  for (const entry of me?.roles?.cache?.values?.() ?? []) {
    const role = entry as { id?: unknown };
    if (typeof role.id === "string") ids.add(role.id);
  }
  return ids;
}

function channelManagerMembers(guild: Guild, resource: ResourceLike): { id: string; administrator: boolean }[] {
  const members: { id: string; administrator: boolean }[] = [];
  for (const memberId of memberOverwriteTargets(resource as PreventableChannel)) {
    const member = guild.members?.cache?.get?.(memberId) ?? null;
    members.push({ id: memberId, administrator: hasPermission(member, "Administrator") });
  }
  return members;
}

function preventionTargets(guild: Guild, resource: ResourceLike): PreventionTarget[] {
  const botRoleIds = botOwnRoleIds(guild);
  const targets: PreventionTarget[] = guildRoles(guild)
    .filter(role => (role.administrator || role.managesChannels) && !botRoleIds.has(role.id))
    .map(role => ({ id: role.id, name: role.name, kind: "role" as const, administrator: role.administrator }));
  for (const member of channelManagerMembers(guild, resource)) {
    targets.push({ id: member.id, name: `membru ${member.id}`, kind: "member", administrator: member.administrator });
  }
  return targets;
}

function isPreviousAccess(value: string): value is PreviousAccess {
  return value === "allow" || value === "deny" || value === "inherit";
}

async function runPrevention(guild: Guild, resource: ResourceLike): Promise<PreventionOutcome | null> {
  const port = adaptPreventionPort(resource as PreventableChannel);
  if (!port) return null;
  return applyChannelPrevention(planChannelPrevention(preventionTargets(guild, resource)), port);
}

function buildCommandHandler(deps: Deps): CommandHandler<Interaction> {
  const repository = createProtectedResourceRepository(deps.ProtectedResourceModel);

  function resolveResource(guild: Guild, type: ProtectedResourceType, targetId: string): (ResourceLike & { id?: string }) | null {
    if (type === "role") return (guild.roles?.cache?.get?.(targetId) as RoleLike | undefined) ?? null;
    return (guild.channels?.cache?.get?.(targetId) as (ResourceLike & { id?: string }) | undefined) ?? null;
  }

  async function addResource(interaction: Interaction, guild: Guild, actorId: string): Promise<unknown> {
    const rawType = interaction.options?.getString?.("type", false) ?? "";
    const targetId = (interaction.options?.getString?.("target", false) ?? "").trim();
    if (!isProtectedResourceType(rawType)) {
      return interaction.reply({ content: "Alege `type`: channel, category sau role.", ephemeral: true });
    }
    if (!/^\d{17,20}$/.test(targetId)) {
      return interaction.reply({ content: "`target` trebuie sa fie ID-ul resursei, adica 17-20 de cifre.", ephemeral: true });
    }

    const resource = resolveResource(guild, rawType, targetId);
    if (!resource) {
      return interaction.reply({ content: `Nu am gasit resursa \`${targetId}\` pe acest server.`, ephemeral: true });
    }
    const channelType = numberOf(resource.type);
    if (rawType === "category" && channelType !== CATEGORY_CHANNEL_TYPE) {
      return interaction.reply({ content: `Resursa \`${targetId}\` nu este o categorie.`, ephemeral: true });
    }
    if (rawType === "channel" && channelType === CATEGORY_CHANNEL_TYPE) {
      return interaction.reply({ content: `Resursa \`${targetId}\` este o categorie; foloseste \`type:category\`.`, ephemeral: true });
    }

    const verdict = evaluateProtectionReadiness(readBotCapability(guild), readinessInputFor(rawType, guild, resource));
    const outcome = await repository.add({
      guildId: guild.id,
      resourceId: targetId,
      type: rawType,
      addedBy: actorId,
      snapshot: captureSnapshot(resource),
      degraded: verdict.degraded,
      degradedReasons: verdict.reasons,
      preventionApplied: false,
      preventionTargets: []
    });

    if (outcome.kind === "already-protected") {
      return interaction.reply({ content: `Resursa \`${targetId}\` este deja protejata.`, ephemeral: true });
    }
    if (outcome.kind === "limit-reached") {
      return interaction.reply({
        content: `Limita de ${outcome.limit} resurse protejate a fost atinsa. Scoate una cu \`action:remove\` inainte sa adaugi alta.`,
        ephemeral: true
      });
    }

    const prevention = rawType === "role" ? null : await runPrevention(guild, resource);
    const reasons = [...verdict.reasons, ...(prevention ? preventionGaps(prevention) : [])];
    const degraded = reasons.length > 0;
    await repository.markReadiness(
      guild.id,
      targetId,
      degraded,
      reasons,
      prevention !== null && preventionHolds(prevention),
      prevention?.restorePoints ?? []
    ).catch(() => false);

    const suffix = degraded
      ? `\nMarcata **degraded**:\n${reasons.map(reason => `- ${reason}`).join("\n")}`
      : "\nProtectie completa: prevenirea si restaurarea sunt posibile.";
    const preventionNote = prevention ? `\n${describePrevention(prevention)}` : "";
    return interaction.reply({
      content: `Resursa \`${targetId}\` a fost adaugata, cu snapshot salvat. Aplicarea in afara raidurilor porneste doar cu \`/start moderation-guard\`.${suffix}${preventionNote}`,
      ephemeral: true
    });
  }

  async function undoPrevention(
    guild: Guild,
    targetId: string,
    saved: readonly { id: string; previous: string }[]
  ): Promise<number> {
    if (saved.length === 0) return 0;
    const resource = guild.channels?.cache?.get?.(targetId) as ResourceLike | undefined;
    const port = resource ? adaptPreventionPort(resource as PreventableChannel) : null;
    if (!port) return 0;
    const points = saved
      .filter(point => isPreviousAccess(point.previous))
      .map(point => ({ id: point.id, previous: point.previous as PreviousAccess }));
    return restoreChannelPrevention(port, points).catch(() => 0);
  }

  async function removeResource(interaction: Interaction, guild: Guild): Promise<unknown> {
    const targetId = (interaction.options?.getString?.("target", false) ?? "").trim();
    if (!/^\d{17,20}$/.test(targetId)) {
      return interaction.reply({ content: "`target` trebuie sa fie ID-ul resursei, adica 17-20 de cifre.", ephemeral: true });
    }
    const record = await repository.read(guild.id, targetId).catch(() => null);
    const restored = await undoPrevention(guild, targetId, record?.preventionTargets ?? []);
    const removed = await repository.remove(guild.id, targetId);
    const restoreNote = restored > 0
      ? ` Accesul Manage Channels restrictionat preventiv a fost restaurat pentru ${restored} tinte.`
      : "";
    return interaction.reply({
      content: removed
        ? `Resursa \`${targetId}\` nu mai este protejata. Resursa in sine nu a fost stearsa.${restoreNote}`
        : `Resursa \`${targetId}\` nu era protejata.`,
      ephemeral: true
    });
  }

  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    const actorId = interaction.user?.id;
    if (!guild || !actorId) {
      return interaction.reply({ content: "Comanda este disponibila doar pe server.", ephemeral: true });
    }
    if (!guild.ownerId || guild.ownerId !== actorId) {
      return interaction.reply({ content: "Doar proprietarul serverului poate administra resursele protejate.", ephemeral: true });
    }

    const action = interaction.options?.getString?.("action", true) ?? "list";
    if (action === "add") return addResource(interaction, guild, actorId);
    if (action === "remove") return removeResource(interaction, guild);

    const records = await repository.list(guild.id);
    return sendTextPages(
      interaction,
      protectedResourceLines(records),
      "Nicio resursa protejata. Adauga una cu `/protected-resource action:add type:<channel|category|role> target:<id>`.",
      true
    );
  }

  return {
    canHandle: (interaction: unknown): interaction is Interaction => isProtectedResourceInteraction(interaction as Interaction),
    handle
  };
}

export default { buildCommandHandler };

export const PROTECTED_RESOURCE_HANDLER_KEYS = ["ProtectedResourceModel"] as const;

type ProtectedResourceKeyCheckDeps = Parameters<typeof buildCommandHandler>[0];
type ProtectedResourceMissing = MissingDependencyKeys<ProtectedResourceKeyCheckDeps, (typeof PROTECTED_RESOURCE_HANDLER_KEYS)[number] & string>;
type ProtectedResourceExtra = ExtraDependencyKeys<ProtectedResourceKeyCheckDeps, (typeof PROTECTED_RESOURCE_HANDLER_KEYS)[number] & string>;
const protectedResourceKeysComplete: ExactDependencyKeys<ProtectedResourceMissing, ProtectedResourceExtra> = true;
