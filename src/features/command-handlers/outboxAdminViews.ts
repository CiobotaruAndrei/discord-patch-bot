"use strict";

import type {
  ChannelPermissions,
  DeadLetterEntryLike,
  GuildSettingsLike,
  OutboxAdminInteraction,
  OutboxModelLike
} from "./outboxAdminContracts";
import { onOff } from "./outboxAdminContracts";
import { clampJoinedList } from "../command-presentation/discordListLimit";
import { countDeadLetters, listDeadLetters, type DeadLetterModelLike } from "../notifications/deadLetterRepository";

export const DEFAULT_DEAD_LETTER_PREVIEW = 10;

export interface OutboxAdminViewsDeps {
  NotificationOutboxModel: Pick<OutboxModelLike, "countDocuments">;
  GuildDeadLetterModel: Pick<DeadLetterModelLike, "countDocuments" | "find">;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
  getOutboxPaused: () => Promise<boolean>;
  checkChannelPermissions: (interaction: OutboxAdminInteraction, channelId: string) => Promise<ChannelPermissions | null>;
  outboxEnabled: boolean;
  recoveryVerifyGlobal: boolean;
  recoveryStrict: boolean;
  deadLetterPreviewLimit?: number;
}

export function formatDeadLetterEntry(entry: DeadLetterEntryLike): string {
  const kind = entry.kind === "discount" ? "reducere" : entry.kind === "youtube" ? "youtube" : "update";
  const title = entry.title && entry.title.trim() ? entry.title.trim() : (entry.itemId || "(necunoscut)");
  const when = entry.failedAt ? new Date(entry.failedAt).toISOString() : "necunoscut";
  const channel = entry.channelId ? `, canal: <#${entry.channelId}>` : "";
  const dedupe = entry.dedupeKey ? `, dedupe: ${String(entry.dedupeKey).slice(0, 12)}` : "";
  return `- [${kind}] ${title} - motiv: ${entry.reason || "necunoscut"}, incercari: ${entry.attempts ?? 0}${channel}${dedupe}, la: ${when}`;
}

export function createOutboxAdminViews(deps: OutboxAdminViewsDeps) {
  const {
    NotificationOutboxModel, GuildDeadLetterModel, getGuildSettings, getOutboxPaused, checkChannelPermissions,
    outboxEnabled, recoveryVerifyGlobal, recoveryStrict
  } = deps;
  const previewLimit = deps.deadLetterPreviewLimit ?? DEFAULT_DEAD_LETTER_PREVIEW;

  async function renderStatus(guildId: string): Promise<string> {
    const [guildQueued, totalQueued, settings, paused, deadLetters] = await Promise.all([
      NotificationOutboxModel.countDocuments({ guildId }).catch(() => 0),
      NotificationOutboxModel.countDocuments({}).catch(() => 0),
      getGuildSettings(guildId).catch(() => null),
      getOutboxPaused().then(value => value as boolean | null).catch(() => null),
      countDeadLetters(GuildDeadLetterModel, guildId).catch(() => 0)
    ]);
    const perGuildVerify = settings?.outboxRecoveryVerify === true;
    const drainState = paused === null ? "NECUNOSCUTA (citirea starii de pauza a esuat)" : paused ? "PE PAUZA" : "ACTIVA";
    return [
      "**Status outbox**",
      `- Outbox activat (global): **${onOff(outboxEnabled)}**`,
      `- Drenare: **${drainState}**`,
      `- Joburi in coada (acest server): **${guildQueued}**`,
      `- Joburi in coada (global): **${totalQueued}**`,
      `- Dead-letter (acest server): **${deadLetters}**`,
      `- Recovery-verify acest server: **${onOff(perGuildVerify)}**`,
      `- Recovery-verify global: **${onOff(recoveryVerifyGlobal)}** | strict: **${onOff(recoveryStrict)}**`
    ].join("\n");
  }

  async function renderDeadLetters(guildId: string): Promise<string> {
    const [recent, total] = await Promise.all([
      listDeadLetters(GuildDeadLetterModel, guildId, previewLimit).catch(() => []),
      countDeadLetters(GuildDeadLetterModel, guildId).catch(() => 0)
    ]);
    if (!recent.length) return "Nicio livrare in dead-letter pentru acest server.";
    const header = `**Dead-letter (ultimele ${recent.length} din ${Math.max(total, recent.length)})**\n`;
    return `${header}${clampJoinedList(recent.map(formatDeadLetterEntry), 2000 - header.length)}`;
  }

  async function renderRecoveryVerifyStatus(guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const perGuildVerify = settings?.outboxRecoveryVerify === true;
    return [
      "**Recovery-verify**",
      `- Acest server: **${onOff(perGuildVerify)}** (seteaza cu \`/set outbox-recovery-verify on|off\`)`,
      `- Global: **${onOff(recoveryVerifyGlobal)}** | strict: **${onOff(recoveryStrict)}**`
    ].join("\n");
  }

  async function renderPermissions(interaction: OutboxAdminInteraction, guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const routeChannelIds = new Set<string>();
    for (const route of settings?.youtubeChannelRoutes || []) {
      for (const id of route.discordChannelIds || []) {
        if (typeof id === "string" && id.length > 0) routeChannelIds.add(id);
      }
    }
    const channels = [
      { label: "Update-uri", id: settings?.notificationChannelId },
      { label: "Reduceri", id: settings?.discountChannelId },
      { label: "YouTube", id: settings?.youtubeNotificationChannelId },
      { label: "DLC", id: settings?.dlcChannelId },
      { label: "Future-release", id: settings?.futureReleaseChannelId },
      ...Array.from(routeChannelIds).map(id => ({ label: "YouTube ruta", id }))
    ].filter((c): c is { label: string; id: string } => typeof c.id === "string" && c.id.length > 0);
    if (!channels.length) {
      return "Niciun canal de notificari configurat. Foloseste `/start updates` / `/start reduceri` / `/youtube notify channel` / `/start dlc` / `/future-release start`.";
    }
    const mark = (ok: boolean) => (ok ? "OK" : "LIPSA");
    const lines: string[] = ["**Permisiuni bot pe canale (audit)**"];
    for (const channel of channels) {
      const perms = await checkChannelPermissions(interaction, channel.id).catch(() => null);
      if (!perms) {
        lines.push(`- ${channel.label} (<#${channel.id}>): necunoscut (canal inaccesibil sau sters?)`);
        continue;
      }
      lines.push(`- ${channel.label} (<#${channel.id}>): View Channel **${mark(perms.viewChannel)}** | Send Messages **${mark(perms.sendMessages)}** | Embed Links **${mark(perms.embedLinks)}** | Read Message History **${mark(perms.readMessageHistory)}**`);
      if (!perms.readMessageHistory) {
        lines.push("  :warning: fara Read Message History, recovery-verify nu poate citi istoricul canalului");
      }
    }
    return lines.join("\n");
  }

  return { renderStatus, renderDeadLetters, renderRecoveryVerifyStatus, renderPermissions };
}
