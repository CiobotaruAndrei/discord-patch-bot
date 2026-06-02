"use strict";

const { errorDetail, errorMessage } = require("../../shared/errors");

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string } & Record<string, unknown>;
type DiscordInteraction = {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommandGroup(required: false): string | null;
    getSubcommand(): string;
  };
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
};
type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;

interface OutboxModelLike {
  countDocuments(filter?: unknown): Promise<number>;
  updateMany(filter: unknown, update: unknown): Promise<{ modifiedCount?: number; matchedCount?: number }>;
}

interface DeadLetterEntryLike {
  kind?: string;
  itemId?: string;
  title?: string;
  reason?: string;
  attempts?: number;
  failedAt?: Date | string;
}

interface GuildSettingsLike {
  outboxRecoveryVerify?: boolean;
  notificationDeadLetter?: DeadLetterEntryLike[];
}

type Logger = (level: string, context: string, msg: string, meta?: unknown) => void;

type OutboxAdminDeps = {
  NotificationOutboxModel: OutboxModelLike;
  getGuildSettings: (guildId: string) => Promise<GuildSettingsLike | null>;
  safeDefer: (interaction: DiscordInteraction) => Promise<unknown>;
  safeEdit: (interaction: DiscordInteraction, content: string) => Promise<unknown>;
  formatUserError: (err: unknown, fallback: string, code?: string) => string;
  logger: Logger;
  outboxEnabled: boolean;
  recoveryVerifyGlobal: boolean;
  recoveryStrict: boolean;
  deadLetterPreviewLimit?: number;
};

type OutboxAdminContext = OutboxAdminDeps & {
  MessageFlags: { Ephemeral: number };
  handleInteraction?: NextInteractionHandler;
};

const DEFAULT_DEAD_LETTER_PREVIEW = 10;

function onOff(value: boolean): string {
  return value ? "ON" : "OFF";
}

function formatDeadLetterEntry(entry: DeadLetterEntryLike): string {
  const kind = entry.kind === "discount" ? "reducere" : "update";
  const title = entry.title && entry.title.trim() ? entry.title.trim() : (entry.itemId || "(necunoscut)");
  const when = entry.failedAt ? new Date(entry.failedAt).toISOString() : "necunoscut";
  return `- [${kind}] ${title} - motiv: ${entry.reason || "necunoscut"}, incercari: ${entry.attempts ?? 0}, la: ${when}`;
}

function createOutboxAdminHandler(deps: OutboxAdminDeps) {
  const {
    NotificationOutboxModel, getGuildSettings, safeDefer, safeEdit, formatUserError, logger,
    outboxEnabled, recoveryVerifyGlobal, recoveryStrict
  } = deps;
  const previewLimit = deps.deadLetterPreviewLimit ?? DEFAULT_DEAD_LETTER_PREVIEW;

  async function renderStatus(guildId: string): Promise<string> {
    const [guildQueued, totalQueued, settings] = await Promise.all([
      NotificationOutboxModel.countDocuments({ guildId }).catch(() => 0),
      NotificationOutboxModel.countDocuments({}).catch(() => 0),
      getGuildSettings(guildId).catch(() => null)
    ]);
    const deadLetters = settings?.notificationDeadLetter?.length ?? 0;
    const perGuildVerify = settings?.outboxRecoveryVerify === true;
    return [
      "**Status outbox**",
      `- Outbox activat (global): **${onOff(outboxEnabled)}**`,
      `- Joburi in coada (acest server): **${guildQueued}**`,
      `- Joburi in coada (global): **${totalQueued}**`,
      `- Dead-letter (acest server): **${deadLetters}**`,
      `- Recovery-verify acest server: **${onOff(perGuildVerify)}**`,
      `- Recovery-verify global: **${onOff(recoveryVerifyGlobal)}** | strict: **${onOff(recoveryStrict)}**`
    ].join("\n");
  }

  async function renderDeadLetters(guildId: string): Promise<string> {
    const settings = await getGuildSettings(guildId).catch(() => null);
    const list = Array.isArray(settings?.notificationDeadLetter) ? settings!.notificationDeadLetter! : [];
    if (!list.length) return "Nicio livrare in dead-letter pentru acest server.";
    const recent = list.slice(-previewLimit).reverse();
    const header = `**Dead-letter (ultimele ${recent.length} din ${list.length})**`;
    return [header, ...recent.map(formatDeadLetterEntry)].join("\n");
  }

  async function retryQueued(guildId: string): Promise<string> {
    const res = await NotificationOutboxModel.updateMany(
      { guildId },
      { $set: { availableAt: new Date() }, $unset: { lockedUntil: "", lockedBy: "" } }
    );
    const count = res.modifiedCount ?? res.matchedCount ?? 0;
    return count > 0
      ? `OK: ${count} joburi din coada au fost reprogramate pentru livrare imediata.`
      : "Nu exista joburi in coada pentru acest server.";
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

  async function handleOutboxInteraction(interaction: DiscordInteraction): Promise<unknown> {
    if (!interaction.guild) return undefined;
    const guildId = interaction.guild.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    await safeDefer(interaction);

    try {
      if (group === "recovery-verify" && sub === "status") {
        return safeEdit(interaction, await renderRecoveryVerifyStatus(guildId));
      }
      if (!group) {
        if (sub === "status") return safeEdit(interaction, await renderStatus(guildId));
        if (sub === "deadletters") return safeEdit(interaction, await renderDeadLetters(guildId));
        if (sub === "retry") return safeEdit(interaction, await retryQueued(guildId));
      }
      logger("WARN", "OUTBOX_COMMAND", `Subcomanda /outbox necunoscuta: ${group ? `${group} ` : ""}${sub}`);
      return safeEdit(interaction, `Eroare: Subcomanda \`/outbox ${group ? `${group} ` : ""}${sub}\` nu este recunoscuta.`);
    } catch (err: unknown) {
      logger("WARN", "OUTBOX_COMMAND", `Eroare la /outbox ${sub}`, errorMessage(err));
      return safeEdit(interaction, formatUserError(err, "Eroare la procesarea comenzii /outbox."));
    }
  }

  return { handleOutboxInteraction };
}

function isDirectOutboxCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "outbox";
}

function installOutboxAdminHandler(target: OutboxAdminContext): void {
  const previousHandleInteraction = target.handleInteraction;
  const handlers = createOutboxAdminHandler({
    NotificationOutboxModel: target.NotificationOutboxModel,
    getGuildSettings: target.getGuildSettings,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    formatUserError: target.formatUserError,
    logger: target.logger,
    outboxEnabled: process.env.NOTIFICATION_OUTBOX_ENABLED === "true",
    recoveryVerifyGlobal: process.env.NOTIFICATION_OUTBOX_RECOVERY_VERIFY === "true",
    recoveryStrict: process.env.NOTIFICATION_OUTBOX_RECOVERY_STRICT === "true"
  });

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!isDirectOutboxCommand(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    try {
      return await handlers.handleOutboxInteraction(interaction);
    } catch (err: unknown) {
      target.logger?.("ERROR", "OUTBOX_INTERACTION", "Eroare in handler-ul /outbox", errorDetail(err));
      const payload = { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: target.MessageFlags.Ephemeral };
      try {
        if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {  }
      return undefined;
    }
  }

  Object.assign(target, handlers, { handleInteraction });
}

Object.assign(installOutboxAdminHandler, { createOutboxAdminHandler, isDirectOutboxCommand });

export = installOutboxAdminHandler;
