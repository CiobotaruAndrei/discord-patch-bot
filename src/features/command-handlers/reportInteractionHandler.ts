"use strict";

import type { CommandHandler } from "../command-registry/commandHandler";
import { clampJoinedList } from "../command-presentation/discordListLimit";

const { errorDetail } = require("../../shared/errors");
const defaultRequireGuildAdmin = require("../command-security/adminPermissionGuard") as RequireGuildAdmin;
const feedback = require("../feedback/feedbackRepository") as {
  normalizeReportType: (value: string | null | undefined) => string;
  reportTypeLabel: (value: string) => string;
};

type MaybePromise<T> = T | Promise<T>;
type GameConfig = { key: string; name: string } & Record<string, unknown>;
type RequireGuildAdmin = (interaction: DiscordInteraction) => Promise<boolean>;

type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?: () => boolean;
  reply: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  options: {
    getSubcommand?: (required?: boolean) => string;
    getString: (name: string) => string | null;
    getInteger?: (name: string) => number | null;
  };
};

type NextInteractionHandler = (interaction: DiscordInteraction, games: GameConfig[]) => MaybePromise<unknown>;
type Logger = (level: string, context: string, message: string, meta?: unknown) => void;
type CommandLogEnd = (status?: string, endExtra?: Record<string, unknown>) => void;

interface ReportRecord {
  id?: string;
  guildId: string;
  userId: string;
  type: string;
  gameKey: string;
  detail: string;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string;
}

interface ReportHandlerDeps {
  logger: Logger;
  enforceCooldown: (interaction: DiscordInteraction, command: string) => Promise<boolean>;
  startCommandLog: (interaction: DiscordInteraction, command: string, extra?: Record<string, unknown>) => CommandLogEnd;
  safeDefer: (interaction: DiscordInteraction, ephemeral?: boolean) => Promise<void>;
  safeEdit: (interaction: DiscordInteraction, payload: unknown) => Promise<unknown>;
  recordFeedbackReport: (input: { guildId: string; userId: string; type: string; gameKey: string; detail: string }) => Promise<ReportRecord>;
  getRecentFeedbackReports: (guildId: string, limit: number) => Promise<ReportRecord[]>;
  resolveFeedbackReport: (guildId: string, reportId: string, resolvedBy: string) => Promise<boolean>;
  requireGuildAdmin: RequireGuildAdmin;
  adminAlert: (kind: string, title: string, body: string, guildId?: string) => Promise<unknown>;
  MessageFlags: { Ephemeral: number };
}

type ReportContext = Omit<ReportHandlerDeps, "requireGuildAdmin"> & {
  requireGuildAdmin?: RequireGuildAdmin;
  handleInteraction?: NextInteractionHandler;
};

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

function getReportSubcommand(interaction: DiscordInteraction): string {
  try {
    return interaction.options.getSubcommand?.(false) || "submit";
  } catch {
    return "submit";
  }
}

function truncateListText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3)}...`;
}

function buildReportListEmbed(records: ReportRecord[]): { title: string; description: string; color: number; footer: { text: string } } {
  if (!records.length) {
    return {
      title: "Rapoarte recente",
      description: "Nu exista rapoarte pentru acest server.",
      color: 0x95a5a6,
      footer: { text: "Foloseste /report submit pentru a inregistra o problema." }
    };
  }

  const lines: string[] = [];
  for (const record of records) {
    const id = record.id || "fara-id";
    const status = record.resolvedAt ? "rezolvat" : "deschis";
    const game = record.gameKey ? ` | joc: ${record.gameKey}` : "";
    const detail = record.detail ? ` | ${truncateListText(record.detail, 120)}` : "";
    lines.push(`\`${id}\` - ${status} - ${feedback.reportTypeLabel(record.type)}${game}${detail}`);
  }

  return {
    title: `Rapoarte recente (${records.length})`,
    description: clampJoinedList(lines, 4096),
    color: records.some(record => !record.resolvedAt) ? 0xe67e22 : 0x2ecc71,
    footer: { text: "Rezolvare: /report resolve id:<id>" }
  };
}

function createReportInteractionHandler(deps: ReportHandlerDeps) {
  const {
    enforceCooldown, startCommandLog, safeDefer, safeEdit, recordFeedbackReport,
    getRecentFeedbackReports, resolveFeedbackReport, requireGuildAdmin, adminAlert, MessageFlags
  } = deps;

  async function handleReportSubmit(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await enforceCooldown(interaction, "report"))) return undefined;
    const type = feedback.normalizeReportType(interaction.options.getString("tip"));
    const detail = interaction.options.getString("detalii") || "";
    const gameKey = interaction.options.getString("joc") || "";
    const userId = interaction.user?.id || "";
    const endLog = startCommandLog(interaction, "report:submit", { type });
    await safeDefer(interaction, true);
    try {
      const record = await recordFeedbackReport({ guildId, userId, type, gameKey, detail });
      adminAlert("feedback:report", `Raport nou: ${feedback.reportTypeLabel(record.type)}`, buildReportAlertBody(record), guildId).catch(() => null);
      endLog("ok");
      return safeEdit(interaction, { embeds: [buildReportConfirmEmbed(record)] });
    } catch (err) {
      endLog("error");
      deps.logger("WARN", "REPORT_INTERACTION", "Nu am putut salva raportul", errorDetail(err));
      return safeEdit(interaction, "Eroare: nu am putut salva raportul acum. Incearca din nou mai tarziu.");
    }
  }

  async function handleReportList(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await requireGuildAdmin(interaction))) return undefined;
    if (!(await enforceCooldown(interaction, "report:list"))) return undefined;
    const limit = interaction.options.getInteger?.("numar") ?? 10;
    const endLog = startCommandLog(interaction, "report:list", { limit });
    await safeDefer(interaction, true);
    const records = await getRecentFeedbackReports(guildId, limit);
    endLog("ok", { count: records.length });
    return safeEdit(interaction, { embeds: [buildReportListEmbed(records)] });
  }

  async function handleReportResolve(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await requireGuildAdmin(interaction))) return undefined;
    if (!(await enforceCooldown(interaction, "report:resolve"))) return undefined;
    const reportId = String(interaction.options.getString("id") || "").trim();
    if (!reportId) {
      return interaction.reply({ content: "Eroare: trebuie sa dai `id` pentru raport.", flags: MessageFlags.Ephemeral });
    }
    const endLog = startCommandLog(interaction, "report:resolve", { reportId });
    await safeDefer(interaction, true);
    const ok = await resolveFeedbackReport(guildId, reportId, interaction.user?.id || "");
    endLog(ok ? "ok" : "not_found");
    return safeEdit(interaction, ok
      ? `OK: raportul \`${reportId}\` a fost marcat ca rezolvat.`
      : `Nu am gasit un raport cu id-ul \`${reportId}\` pe acest server.`);
  }

  async function handleReportInteraction(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) {
      return interaction.reply({ content: "Eroare: comanda /report merge doar pe un server.", flags: MessageFlags.Ephemeral });
    }
    const subcommand = getReportSubcommand(interaction);
    if (subcommand === "list") return handleReportList(interaction, guildId);
    if (subcommand === "resolve") return handleReportResolve(interaction, guildId);
    return handleReportSubmit(interaction, guildId);
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
  buildReportListEmbed: typeof buildReportListEmbed;
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
    getRecentFeedbackReports: target.getRecentFeedbackReports,
    resolveFeedbackReport: target.resolveFeedbackReport,
    requireGuildAdmin: target.requireGuildAdmin || defaultRequireGuildAdmin,
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
installReportInteraction.buildReportListEmbed = buildReportListEmbed;

export = installReportInteraction;
