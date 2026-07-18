"use strict";

import type { CommandHandler } from "../command-registry/commandHandler.js";
import { handledCommandError } from "../command-security/commandOutcome.js";
import { errorDetail } from "../../shared/errors.js";
import moderationRepository, { type ModerationRecord } from "../moderation/moderationRepository.js";

type User = { id: string; username?: string; bot?: boolean };
type Role = { position?: number };
type Member = { id: string; user?: User; roles?: { highest?: Role }; timeout?: (duration: number | null, reason?: string) => Promise<unknown>; kick?: (reason?: string) => Promise<unknown>; ban?: (options?: { reason?: string }) => Promise<unknown> };
type Guild = { id: string; ownerId?: string; members: { me?: Member; fetch(userId: string): Promise<Member> }; unban?: (userId: string, reason?: string) => Promise<unknown> };
type Interaction = {
  commandName?: string;
  guild?: Guild | null;
  user?: User | null;
  member?: Member | null;
  channel?: { send?: (payload: unknown) => Promise<unknown> } | null;
  deferred?: boolean;
  replied?: boolean;
  options: { getSubcommand?(required?: boolean): string; getUser(name: string, required?: boolean): User | null; getString(name: string, required?: boolean): string | null; getInteger(name: string, required?: boolean): number | null };
  isChatInputCommand?: () => boolean;
  reply(payload: unknown): Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};
type Deps = {
  GuildModel: Parameters<typeof moderationRepository.getModerationState>[0];
  MessageFlags: { Ephemeral: number };
  safeDefer(interaction: Interaction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: Interaction, payload: unknown): Promise<unknown>;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
};

const ADMIN_ACTIONS = new Set(["timeout", "remove-timeout", "mute", "unmute", "kick", "ban", "unban", "warn", "remove-warn", "warn-ban-limit"]);
const LIST_ACTIONS = new Set(["timeout-list", "mute-list", "warn-list"]);

function durationMs(value: string): number | null {
  const match = /^([1-9][0-9]{0,5})(s|m|h|d|w)$/i.exec(value.trim());
  if (!match) return null;
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const result = Number(match[1]) * units[match[2].toLowerCase()];
  return result > 0 && result <= 28 * 86_400_000 ? result : null;
}

function highest(member: Member | null | undefined): number { return member?.roles?.highest?.position ?? 0; }

async function targetMember(interaction: Interaction, user: User): Promise<Member | null> {
  if (!interaction.guild) return null;
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

function canAct(interaction: Interaction, target: Member | null): boolean {
  const guild = interaction.guild;
  if (!guild || !target || !interaction.user) return false;
  if (target.id === interaction.user.id || target.user?.bot || target.id === guild.ownerId) return false;
  const actor = interaction.member;
  if (actor && interaction.user.id !== guild.ownerId && highest(actor) <= highest(target)) return false;
  const me = guild.members.me;
  if (me && highest(me) <= highest(target)) return false;
  return true;
}

function hasPermission(member: Member | undefined, permission: string): boolean {
  const candidate = member as Member & { permissions?: { has(value: string): boolean } } | undefined;
  return candidate?.permissions?.has?.(permission) ?? false;
}

function mention(userId: string, name?: string): string { return name ? `${name} (<@${userId}>)` : `<@${userId}>`; }
function safeReason(reason: string): string { return reason.replace(/https?:\/\/\S+/gi, "[link eliminat]"); }
function optionUser(interaction: Interaction): User | null { return interaction.options.getUser("utilizator", false) ?? interaction.options.getUser("user", false); }
function optionString(interaction: Interaction, primary: string, fallback: string): string | null { return interaction.options.getString(primary, false) ?? interaction.options.getString(fallback, false); }
function optionInteger(interaction: Interaction, primary: string, fallback: string): number | null { return interaction.options.getInteger(primary, false) ?? interaction.options.getInteger(fallback, false); }
function formatRecord(record: ModerationRecord): string {
  const applied = new Date(record.appliedAt).getTime();
  const expiry = record.expiresAt ? new Date(record.expiresAt).getTime() : null;
  const expiryText = expiry ? `<t:${Math.floor(expiry / 1000)}:F> (<t:${Math.floor(expiry / 1000)}:R>)` : "permanent";
  return `${mention(record.userId, record.username)} [${record.userId}] — aplicat de <@${record.moderatorId}> la <t:${Math.floor(applied / 1000)}:F>, expira ${expiryText}`;
}

function createModerationInteractionHandler(deps: Deps) {
  const { GuildModel, MessageFlags, safeDefer, safeEdit } = deps;
  async function handle(interaction: Interaction): Promise<unknown> {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: "Eroare: comanda este disponibila doar pe server.", flags: MessageFlags.Ephemeral });
    const command = interaction.commandName || "";
    if (LIST_ACTIONS.has(command)) {
      const state = await moderationRepository.getModerationState(GuildModel, guild.id);
      const records = command === "timeout-list" ? state.moderationTimeouts : command === "mute-list" ? state.moderationMutes : undefined;
      if (records) return interaction.reply(records.length ? records.map(formatRecord).join("\n") : "Lista este goala.");
      const byUser = new Map<string, number>();
      for (const warning of state.moderationWarnings ?? []) byUser.set(warning.userId, (byUser.get(warning.userId) ?? 0) + 1);
      const rows = [...byUser.entries()].sort((left, right) => right[1] - left[1]).map(([id, count]) => `${mention(id)} — ${count} warn(uri)`);
      return interaction.reply(rows.length ? rows.join("\n") : "Lista este goala.");
    }
    await safeDefer(interaction, true);
    const reason = optionString(interaction, "motiv", "reason") || undefined;
    const moderatorId = interaction.user?.id || "";
    if (command === "warn-ban-limit") {
      const limit = optionInteger(interaction, "numar", "number");
      if (!limit || limit < 1) return safeEdit(interaction, "Eroare: limita trebuie sa fie un numar intreg pozitiv.");
      const change = await moderationRepository.setWarnBanLimitWithPrevious(GuildModel, guild.id, limit);
      return safeEdit(interaction, `OK: limita de warn-uri a fost schimbata: ${change.previous} -> ${change.next}.`);
    }
    const selectedUser = optionUser(interaction);
    if (!selectedUser) return safeEdit(interaction, "Eroare: trebuie sa selectezi un utilizator.");
    const user = selectedUser;
    if (command === "unban") {
      if (!hasPermission(guild.members.me, "BanMembers") || typeof guild.unban !== "function") return safeEdit(interaction, "Eroare: botul nu poate debana utilizatori.");
      await guild.unban(user.id, reason);
      return safeEdit(interaction, `OK: ${mention(user.id, user.username)} a fost debanat.`);
    }
    const target = await targetMember(interaction, user);
    if (!target || !canAct(interaction, target)) return safeEdit(interaction, "Eroare: utilizatorul nu poate fi sanctionat din cauza ierarhiei, a tipului de cont sau a absentei pe server.");
    if (command === "timeout" || command === "mute") {
      const duration = durationMs(optionString(interaction, "durata", "duration") || "");
      if (!duration) return safeEdit(interaction, "Eroare: durata trebuie sa fie intre 1s si 28d (exemplu: 30m, 2h, 1d).");
      if (!hasPermission(guild.members.me, "ModerateMembers")) return safeEdit(interaction, "Eroare: botul nu are permisiunea Moderate Members.");
      if (typeof target.timeout !== "function") return safeEdit(interaction, "Eroare: Discord nu permite timeout pentru acest utilizator.");
      await target.timeout(duration, reason);
      const record: ModerationRecord = { userId: user.id, username: user.username || user.id, moderatorId, appliedAt: new Date(), expiresAt: new Date(Date.now() + duration), reason: reason ? safeReason(reason) : undefined };
      if (command === "timeout") await moderationRepository.saveTimeout(GuildModel, guild.id, record);
      else await moderationRepository.saveMute(GuildModel, guild.id, record);
      return safeEdit(interaction, `OK: ${mention(user.id, user.username)} a primit ${command === "timeout" ? "timeout" : "mute"} pana <t:${Math.floor((Date.now() + duration) / 1000)}:F>.`);
    }
    if (command === "remove-timeout" || command === "unmute") {
      if (!hasPermission(guild.members.me, "ModerateMembers")) return safeEdit(interaction, "Eroare: botul nu are permisiunea Moderate Members.");
      const field = command === "remove-timeout" ? "moderationTimeouts" : "moderationMutes";
      const result = await moderationRepository.removeModerationWithOpposite(GuildModel, guild.id, field, user.id);
      if (!result.removed) return safeEdit(interaction, result.opposite
        ? `Utilizatorul are sanctiunea opusa. Foloseste /${command === "unmute" ? "remove-timeout" : "unmute"}.`
        : `Nu exista un ${command === "unmute" ? "mute" : "timeout"} activ pentru ${mention(user.id, user.username)}.`);
      if (typeof target.timeout === "function") await target.timeout(null);
      return safeEdit(interaction, `OK: sanctiunea a fost eliminata pentru ${mention(user.id, user.username)}.`);
    }
    if (command === "kick" || command === "ban") {
      if (!hasPermission(guild.members.me, command === "kick" ? "KickMembers" : "BanMembers")) return safeEdit(interaction, `Eroare: botul nu are permisiunea ${command === "kick" ? "Kick Members" : "Ban Members"}.`);
      if (command === "kick") { if (typeof target.kick !== "function") return safeEdit(interaction, "Eroare: kick indisponibil."); await target.kick(reason); }
      else { if (typeof target.ban !== "function") return safeEdit(interaction, "Eroare: ban indisponibil."); await target.ban({ reason }); }
      return safeEdit(interaction, `OK: ${mention(user.id, user.username)} a fost ${command === "kick" ? "eliminat" : "banat"}.`);
    }
    if (command === "warn" || command === "remove-warn") {
      if (command === "remove-warn") {
        const count = await moderationRepository.removeWarning(GuildModel, guild.id, user.id);
        return safeEdit(interaction, count ? `OK: ${mention(user.id, user.username)} are ${count} warn(uri) ramase.` : "Utilizatorul nu are warn-uri active.");
      }
      if (!reason?.trim()) return safeEdit(interaction, "Eroare: motivul warn-ului este obligatoriu.");
      const result = await moderationRepository.addWarning(GuildModel, guild.id, { userId: user.id, username: user.username || user.id, moderatorId, warnedAt: new Date(), reason: safeReason(reason) });
      let suffix = "";
      if (result.limit > 0 && result.count >= result.limit && typeof target.ban === "function" && hasPermission(guild.members.me, "BanMembers")) {
        await target.ban({ reason: `Limita de warn-uri atinsa (${result.limit})` });
        suffix = " Utilizatorul a fost banat automat dupa atingerea limitei.";
      }
      if (interaction.channel?.send) await interaction.channel.send({ content: `Warn pentru ${mention(user.id, user.username)} (${result.count} total) — motiv: ${safeReason(reason)}` }).catch(() => undefined);
      return safeEdit(interaction, `OK: ${mention(user.id, user.username)} a primit warn-ul #${result.count}.${suffix}`);
    }
    return safeEdit(interaction, "Eroare: comanda de moderare nu este recunoscuta.");
  }
  return { handle };
}

function isModerationCommand(interaction: Interaction): boolean {
  return interaction?.isChatInputCommand?.() === true && Boolean(interaction.guild) && (ADMIN_ACTIONS.has(interaction.commandName || "") || LIST_ACTIONS.has(interaction.commandName || ""));
}

function buildModerationCommandHandler(target: Deps) {
  const handlers = createModerationInteractionHandler(target);
  const command: CommandHandler<Interaction> = {
    canHandle: (interaction): interaction is Interaction => isModerationCommand(interaction as Interaction),
    handle: async interaction => {
      try { return await handlers.handle(interaction); }
      catch (err: unknown) {
        target.logger?.("ERROR", "MODERATION", "Eroare la comanda de moderare", errorDetail(err));
        const payload = { content: "Eroare: nu am putut executa actiunea de moderare.", flags: target.MessageFlags.Ephemeral };
        try { if ((interaction.deferred || interaction.replied) && interaction.followUp) await interaction.followUp(payload); else await interaction.reply(payload); } catch {}
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

export default { createModerationInteractionHandler, buildCommandHandler: buildModerationCommandHandler };
