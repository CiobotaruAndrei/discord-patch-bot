"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";

const { errorDetail } = require("../../shared/errors");
const feedback = require("../feedback/feedbackRepository") as {
  normalizeReportType: (value: string | null | undefined) => string;
  reportTypeLabel: (value: string) => string;
};

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;

type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  options: { getString: (name: string) => string | null };
};

type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

interface ReportRecord {
  guildId: string;
  userId: string;
  type: string;
  gameKey: string;
  detail: string;
  createdAt: Date;
}

interface ReportHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown>;
  recordFeedbackReport: (input: { guildId: string; userId: string; type: string; gameKey: string; detail: string }) => Promise<ReportRecord>;
  adminAlert: (kind: string, title: string, body: string) => Promise<unknown>;
  MessageFlags: { Ephemeral: number };
}

type ReportContext = ReportHandlerDeps & { handleInteraction?: NextInteractionHandler };

function buildReportConfirmEmbed(record: ReportRecord): { title: string; description: string; color: number } {
  const lines = [`**Tip:** ${feedback.reportTypeLabel(record.type)}`];
  if (record.gameKey) lines.push(`**Joc:** ${record.gameKey.slice(0, 100)}`);
  if (record.detail) lines.push(`**Detalii:** ${record.detail.slice(0, 500)}`);
  return {
    title: "Multumesc pentru raport! ✅",
    description: `Am inregistrat raportul tau si il vor vedea administratorii.\n\n${lines.join("\n")}`,
    color: 0x2ecc71
  };
}

function buildReportAlertBody(record: ReportRecord): string {
  const parts = [
    `Server: ${record.guildId}`,
    `Utilizator: ${record.userId || "?"}`,
    `Tip: ${feedback.reportTypeLabel(record.type)}`
  ];
  if (record.gameKey) parts.push(`Joc: ${record.gameKey}`);
  if (record.detail) parts.push(`Detalii: ${record.detail}`);
  return parts.join("\n");
}

function createReportInteractionHandler(deps: ReportHandlerDeps) {
  const { enforceCooldown, startCommandLog, safeDefer, safeEdit, recordFeedbackReport, adminAlert, MessageFlags } = deps;

  async function handleReportInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) {
      return interaction.reply({ content: "Eroare: comanda /report merge doar pe un server.", flags: MessageFlags.Ephemeral });
    }
    if (!(await enforceCooldown(interaction, "report"))) return undefined;
    const type = feedback.normalizeReportType(interaction.options.getString("tip"));
    const detail = interaction.options.getString("detalii") || "";
    const gameKey = interaction.options.getString("joc") || "";
    const userId = interaction.user?.id || "";
    const endLog = startCommandLog(interaction, "report", { type });
    await safeDefer(interaction, true);
    try {
      const record = await recordFeedbackReport({ guildId, userId, type, gameKey, detail });
      adminAlert("feedback:report", `Raport nou: ${feedback.reportTypeLabel(record.type)}`, buildReportAlertBody(record)).catch(() => null);
      endLog("ok");
      return safeEdit(interaction, { embeds: [buildReportConfirmEmbed(record)] });
    } catch (err) {
      endLog("error");
      deps.logger("WARN", "REPORT_INTERACTION", "Nu am putut salva raportul", errorDetail(err));
      return safeEdit(interaction, "Eroare: nu am putut salva raportul acum. Incearca din nou mai tarziu.");
    }
  }

  return { handleReportInteraction };
}

function isReportCommand(interaction: DiscordInteraction): boolean {
  return interaction?.isChatInputCommand?.() === true
    && Boolean(interaction.guild)
    && interaction.commandName === "report";
}

function createInteractionErrorPayload(MessageFlags: { Ephemeral: number }) {
  return { content: "Eroare: Eroare neasteptata la procesarea comenzii.", flags: MessageFlags.Ephemeral };
}

type ReportInstaller = ((target: ReportContext) => void) & {
  createReportInteractionHandler: typeof createReportInteractionHandler;
  buildReportConfirmEmbed: typeof buildReportConfirmEmbed;
  buildReportAlertBody: typeof buildReportAlertBody;
  buildCommandHandler: typeof buildReportCommandHandler;
};

function buildReportCommandHandler(target: ReportContext) {
  const handlers = createReportInteractionHandler({
    logger: target.logger,
    enforceCooldown: target.enforceCooldown,
    startCommandLog: target.startCommandLog,
    safeDefer: target.safeDefer,
    safeEdit: target.safeEdit,
    recordFeedbackReport: target.recordFeedbackReport,
    adminAlert: target.adminAlert,
    MessageFlags: target.MessageFlags
  });
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isReportCommand(interaction as DiscordInteraction),
    handle: async (interaction) => {
      const di = interaction;
      try {
        return await handlers.handleReportInteraction(di);
      } catch (err: unknown) {
        target.logger?.("ERROR", "REPORT_INTERACTION", "Eroare in handler-ul /report", errorDetail(err));
        const payload = createInteractionErrorPayload(target.MessageFlags);
        try {
          if ((di.deferred || di.replied) && typeof di.followUp === "function") {
            await di.followUp(payload);
          } else {
            await di.reply(payload);
          }
        } catch {  }
        return undefined;
      }
    }
  };
  return { handlers, ...command };
}

const installReportInteraction = ((target: ReportContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildReportCommandHandler(target);

  async function handleInteraction(interaction: DiscordInteraction, games: GameConfig[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }

  Object.assign(target, handlers, { handleInteraction });
}) as ReportInstaller;

installReportInteraction.buildCommandHandler = buildReportCommandHandler;

installReportInteraction.createReportInteractionHandler = createReportInteractionHandler;
installReportInteraction.buildReportConfirmEmbed = buildReportConfirmEmbed;
installReportInteraction.buildReportAlertBody = buildReportAlertBody;

export = installReportInteraction;
