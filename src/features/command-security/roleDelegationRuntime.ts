"use strict";

import type { PermissionDelegationRuntimeDeps, AuditMatch, RoleLike, MemberLike, ChannelLike, GuildLike, AuditEntryId, RecordedObservationEvent } from "./permissionDelegationContext.js";
import { auditMatch, channelOverwriteMatch, matchWithRetry, explicitProtectedPermissions, explicitlyHas, grantedProtectedPermissions, protectedMask, requireBitfield, roles, overwrites, CHANNEL_PROTECTED_PERMISSIONS, PROTECTED_PERMISSIONS } from "./permissionDelegationContext.js";
import { recordServerAuditEntry } from "../admin-records/auditLogRepository.js";
import { AuditLogEvent, PermissionFlagsBits } from "discord.js";
import type { SensitiveActionObserver } from "./sensitiveActionObserver.js";
import { createDelegationAuthorizer, describeSanctionOutcome, reportRaidEscalation, reverts, sanctionDelegationAuthor } from "./delegationAuthorization.js";

export function createRoleDelegationRuntime(deps: PermissionDelegationRuntimeDeps, observer: SensitiveActionObserver) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const { observeSensitiveAction, shouldSendIndividualAlert, markProcessed, processedAuditEntries } = observer;

  const authorized = createDelegationAuthorizer(deps);


  async function handleRoleUpdate(previous: RoleLike, next: RoleLike): Promise<void> {
    const granted = grantedProtectedPermissions(
      requireBitfield(previous.permissions, `rolul ${next.id} (stare anterioara)`),
      requireBitfield(next.permissions, `rolul ${next.id}`)
    );
    if (!granted.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => auditMatch(next.guild, AuditLogEvent.RoleUpdate, next.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.setPermissions) throw new Error(`Permisiunile rolului ${next.id} nu pot fi restaurate.`);
    const currentBits = requireBitfield(next.permissions, `rolul ${next.id} (stare curenta)`);
    const stillGranted = granted.filter(({ flag }) => explicitlyHas(currentBits, flag));
    if (!stillGranted.length) return;
    const verdict = await authorized(next.guild.id, actorId, stillGranted.map(({ label }) => label), next.id);
    if (!reverts(verdict)) return;
    if (verdict === "revert-raid") await reportRaidEscalation(deps, next.guild.id, actorId, "role-permissions");
    markProcessed(match);
    await next.setPermissions(currentBits & ~protectedMask(stillGranted), "Protectie anti-delegare: numai ownerul poate acorda permisiuni sensibile");
    deps.metrics?.reverted();
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-permissions-reverted",
      details: `roleId=${next.id}; roleName=${next.name ?? ""}; removed=${stillGranted.map(({ label }) => label).join("+")}`
    });
    const sanction = await sanctionDelegationAuthor(deps, next.guild.id, actorId);
    const observation = await observeSensitiveAction(next.guild.id, actorId, match, "role-permissions", eventTime);
    if (shouldSendIndividualAlert(observation) || sanction.ownerInterventionRequired) await deps.adminAlert(
      sanction.ownerInterventionRequired ? "security:owner-intervention-required" : "security:permission-delegation",
      "Delegare neautorizata de permisiuni restaurata",
      `Rol ${next.name ?? next.id}; permisiuni eliminate: ${stillGranted.map(({ label }) => label).join(", ")}; restul modificarilor raman; actor ${actorId ?? "nedetectat"}. ${describeSanctionOutcome(sanction)}`,
      next.guild.id
    );
  }

  async function handleGuildMemberUpdate(previous: MemberLike, next: MemberLike): Promise<void> {
    const previousRoleIds = new Set(roles(previous).map(role => role.id));
    const addedProtected = roles(next).filter(role =>
      !previousRoleIds.has(role.id)
      && explicitProtectedPermissions(requireBitfield(role.permissions, `rolul ${role.id}`)).length > 0
    );
    if (!addedProtected.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => auditMatch(next.guild, AuditLogEvent.MemberRoleUpdate, next.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === next.guild.ownerId) return;
    if (!next.roles?.remove) throw new Error(`Rolurile sensibile ale membrului ${next.id} nu pot fi restaurate.`);
    const addedLabels = addedProtected.flatMap(role => explicitProtectedPermissions(requireBitfield(role.permissions, `rolul ${role.id}`)).map(({ label }) => label));
    const verdict = await authorized(next.guild.id, actorId, addedLabels, next.id);
    if (!reverts(verdict)) return;
    if (verdict === "revert-raid") await reportRaidEscalation(deps, next.guild.id, actorId, "member-sensitive-role");
    markProcessed(match);
    for (const role of addedProtected) {
      await next.roles.remove(role.id, "Protectie anti-delegare: numai ownerul poate acorda roluri sensibile");
    }
    deps.metrics?.reverted(addedProtected.length);
    await recordServerAuditEntry(deps.GuildAuditLogModel, next.guild.id, {
      userId: actorId ?? "",
      action: "protected-member-roles-reverted",
      details: `memberId=${next.id}; roleIds=${addedProtected.map(role => role.id).join(",")}`
    });
    const sanction = await sanctionDelegationAuthor(deps, next.guild.id, actorId);
    const observation = await observeSensitiveAction(next.guild.id, actorId, match, "member-sensitive-role", eventTime);
    if (shouldSendIndividualAlert(observation) || sanction.ownerInterventionRequired) await deps.adminAlert(
      sanction.ownerInterventionRequired ? "security:owner-intervention-required" : "security:permission-delegation",
      "Roluri sensibile acordate neautorizat si eliminate",
      `Membru ${next.id}; roluri ${addedProtected.map(role => role.name ?? role.id).join(", ")}; actor ${actorId ?? "nedetectat"}. ${describeSanctionOutcome(sanction)}`,
      next.guild.id
    );
  }

  async function handleRoleCreate(role: RoleLike): Promise<void> {
    const grantedAtCreate = explicitProtectedPermissions(requireBitfield(role.permissions, `rolul nou ${role.id}`));
    if (!grantedAtCreate.length) return;
    const eventTime = now();
    const match = await matchWithRetry(() => auditMatch(role.guild, AuditLogEvent.RoleCreate, role.id, eventTime, processedAuditEntries), wait);
    const actorId = match.executorId;
    if (actorId && actorId === role.guild.ownerId) return;
    if (role.managed === true) {
      markProcessed(match);
      await recordServerAuditEntry(deps.GuildAuditLogModel, role.guild.id, {
        userId: actorId ?? "",
        action: "protected-managed-role-created-alerted",
        details: `roleId=${role.id}; roleName=${role.name ?? ""}; managed=true`
      });
      const observation = await observeSensitiveAction(role.guild.id, actorId, match, "managed-role-create", eventTime);
      if (shouldSendIndividualAlert(observation)) await deps.adminAlert(
        "security:permission-delegation",
        "Rol gestionat de integrare creat cu permisiuni sensibile",
        `Rol ${role.name ?? role.id} (gestionat de integrare/bot, permisiunile lui nu se restaureaza automat); actor ${actorId ?? "nedetectat"}; verificare owner necesara`,
        role.guild.id
      );
      return;
    }
    if (!role.setPermissions) throw new Error(`Permisiunile sensibile ale rolului nou ${role.id} nu pot fi eliminate.`);
    const currentBits = requireBitfield(role.permissions, `rolul nou ${role.id} (stare curenta)`);
    const stillGranted = grantedAtCreate.filter(({ flag }) => explicitlyHas(currentBits, flag));
    if (!stillGranted.length) return;
    const verdict = await authorized(role.guild.id, actorId, stillGranted.map(({ label }) => label), role.id);
    if (!reverts(verdict)) return;
    if (verdict === "revert-raid") await reportRaidEscalation(deps, role.guild.id, actorId, "role-create");
    markProcessed(match);
    await role.setPermissions(currentBits & ~protectedMask(stillGranted), "Protectie anti-delegare: numai ownerul poate crea roluri cu permisiuni sensibile");
    deps.metrics?.reverted();
    await recordServerAuditEntry(deps.GuildAuditLogModel, role.guild.id, {
      userId: actorId ?? "",
      action: "protected-role-create-reverted",
      details: `roleId=${role.id}; roleName=${role.name ?? ""}; removed=${stillGranted.map(({ label }) => label).join("+")}`
    });
    const sanction = await sanctionDelegationAuthor(deps, role.guild.id, actorId);
    const observation = await observeSensitiveAction(role.guild.id, actorId, match, "role-create", eventTime);
    if (shouldSendIndividualAlert(observation) || sanction.ownerInterventionRequired) await deps.adminAlert(
      sanction.ownerInterventionRequired ? "security:owner-intervention-required" : "security:permission-delegation",
      "Rol nou creat cu permisiuni sensibile; permisiunile sensibile au fost eliminate",
      `Rol ${role.name ?? role.id}; permisiuni eliminate: ${stillGranted.map(({ label }) => label).join(", ")}; permisiunile neprotejate raman; actor ${actorId ?? "nedetectat"}. ${describeSanctionOutcome(sanction)}`,
      role.guild.id
    );
  }

  return { handleRoleUpdate, handleGuildMemberUpdate, handleRoleCreate };
}
