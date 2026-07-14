"use strict";

import type { GameConfig, InteractionMessage } from "../../types.js";
import type { BugReportRecord, SaveReportResult, UserComplaintRecord } from "../feedback/reportRepository.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { REPORT_TYPES } from "../feedback/reportTypes.js";
import { errorDetail } from "../../shared/errors.js";

import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

interface DiscordUser {
  id: string;
  bot?: boolean;
  username?: string;
}

interface ModalSubmit {
  customId: string;
  user?: DiscordUser | null;
  deferred?: boolean;
  replied?: boolean;
  fields: { getTextInputValue(id: string): string };
  deferReply?(payload: unknown): Promise<unknown>;
  editReply?(payload: unknown): Promise<unknown>;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
}

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  user?: DiscordUser | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?(): boolean;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
  showModal?(modal: unknown): Promise<unknown>;
  awaitModalSubmit?(options: { time: number; filter(interaction: ModalSubmit): boolean }): Promise<ModalSubmit>;
  options: {
    getSubcommand(required?: boolean): string;
    getSubcommandGroup(required?: boolean): string | null;
    getString(name: string, required?: boolean): string | null;
    getUser(name: string, required?: boolean): DiscordUser | null;
  };
}

interface ReportHandlerDeps {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  enforceCooldown(interaction: DiscordInteraction, command: string): Promise<boolean>;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<InteractionMessage | null>;
  findGameAndSuggestion(query: string, games: GameConfig[]): { game: GameConfig | null; suggestion: GameConfig | null };
  saveBug(input: { guildId: string; reportType: string; gameKey: string; description: string; authorId: string }): Promise<SaveReportResult<BugReportRecord>>;
  saveComplaint(input: { guildId: string; reporterId: string; targetId: string; reason: string }): Promise<SaveReportResult<UserComplaintRecord>>;
  listBugs(guildId: string): Promise<BugReportRecord[]>;
  listComplaints(guildId: string): Promise<UserComplaintRecord[]>;
  removeBug(guildId: string, id: string): Promise<boolean>;
  removeComplaint(guildId: string, id: string): Promise<boolean>;
  adminAlert(kind: string, title: string, body: string, guildId?: string): Promise<unknown>;
  handlePagination<TItem, TEmbed>(message: InteractionMessage, userId: string, prefix: string, items: TItem[], pageSize: number, render: (page: number, totalPages: number) => TEmbed[]): Promise<void>;
  MessageFlags: { Ephemeral: number };
}

const REPORT_PAGE_SIZE = 8;
const MODAL_TIMEOUT_MS = 120_000;
const DESCRIPTION_INPUT_ID = "description";

function reportTypeLabel(value: string): string {
  return REPORT_TYPES.find(type => type.value === value)?.label || value;
}

function modalFor(customId: string, title: string, label: string): InstanceType<typeof ModalBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(DESCRIPTION_INPUT_ID)
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(1000);
  const row = new ActionRowBuilder<InstanceType<typeof TextInputBuilder>>().addComponents(input);
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(row);
}

async function awaitDescription(interaction: DiscordInteraction, title: string, label: string): Promise<{ submit: ModalSubmit; description: string } | null> {
  if (!interaction.showModal || !interaction.awaitModalSubmit || !interaction.user?.id) return null;
  const customId = `report:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  await interaction.showModal(modalFor(customId, title, label));
  const submit = await interaction.awaitModalSubmit({
    time: MODAL_TIMEOUT_MS,
    filter: candidate => candidate.customId === customId && candidate.user?.id === interaction.user?.id
  }).catch(() => null);
  if (!submit) return null;
  const description = submit.fields.getTextInputValue(DESCRIPTION_INPUT_ID).replace(/\s+/g, " ").trim();
  return description ? { submit, description } : null;
}

async function replyModal(submit: ModalSubmit, payload: unknown, flags: number): Promise<unknown> {
  if (!submit.deferred && !submit.replied && submit.deferReply) await submit.deferReply({ flags });
  if (submit.editReply) return submit.editReply(payload);
  if (submit.followUp) return submit.followUp({ ...(typeof payload === "object" && payload ? payload : { content: String(payload) }), flags });
  return submit.reply?.({ ...(typeof payload === "object" && payload ? payload : { content: String(payload) }), flags });
}

function bugLine(record: BugReportRecord): string {
  return `\`${record.id || "fara-id"}\` **${reportTypeLabel(record.reportType)}** | joc: \`${record.gameKey}\` | autor: <@${record.authorId}> | <t:${Math.floor(record.createdAt.getTime() / 1000)}:R>\n${record.description}`;
}

function complaintLine(record: UserComplaintRecord): string {
  return `\`${record.id || "fara-id"}\` reclamant: <@${record.reporterId}> | reclamat: <@${record.targetId}> | <t:${Math.floor(record.createdAt.getTime() / 1000)}:R>\n${record.reason}`;
}

function createReportInteractionHandler(deps: ReportHandlerDeps) {
  async function bug(interaction: DiscordInteraction, games: GameConfig[], guildId: string): Promise<unknown> {
    if (!(await deps.enforceCooldown(interaction, "report bug"))) return undefined;
    const query = String(interaction.options.getString("joc", true) || "").trim();
    const { game, suggestion } = deps.findGameAndSuggestion(query, games);
    if (!game) return interaction.reply?.({ content: suggestion ? `Nu am gasit jocul. Te refereai la **${suggestion.name}**?` : "Nu am gasit jocul.", flags: deps.MessageFlags.Ephemeral });
    const modal = await awaitDescription(interaction, "Raport de bug", "Descrie problema");
    if (!modal) return undefined;
    const result = await deps.saveBug({
      guildId,
      reportType: String(interaction.options.getString("tip", true) || "altceva"),
      gameKey: game.key,
      description: modal.description,
      authorId: interaction.user?.id || ""
    });
    if (!result.created) return replyModal(modal.submit, `Problema exista deja. ID raport: \`${result.record.id}\`.`, deps.MessageFlags.Ephemeral);
    deps.adminAlert("report:bug", `Bug nou pentru ${game.name}`, `${result.record.description}\nID: ${result.record.id}`, guildId).catch(() => undefined);
    return replyModal(modal.submit, `OK: raportul de bug a fost salvat cu ID \`${result.record.id}\`.`, deps.MessageFlags.Ephemeral);
  }

  async function complaint(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    if (!(await deps.enforceCooldown(interaction, "report complaint"))) return undefined;
    const target = interaction.options.getUser("target", true);
    if (!target) return interaction.reply?.({ content: "Eroare: selecteaza un membru.", flags: deps.MessageFlags.Ephemeral });
    if (target.id === interaction.user?.id) return interaction.reply?.({ content: "Eroare: nu te poti reclama pe tine.", flags: deps.MessageFlags.Ephemeral });
    if (target.bot) return interaction.reply?.({ content: "Eroare: botii nu pot fi reclamati prin aceasta comanda.", flags: deps.MessageFlags.Ephemeral });
    const modal = await awaitDescription(interaction, "Reclamatie membru", "Motivul reclamatiei");
    if (!modal) return undefined;
    const result = await deps.saveComplaint({ guildId, reporterId: interaction.user?.id || "", targetId: target.id, reason: modal.description });
    if (!result.created) return replyModal(modal.submit, `Reclamatia exista deja. ID: \`${result.record.id}\`.`, deps.MessageFlags.Ephemeral);
    deps.adminAlert("report:complaint", `Reclamatie noua impotriva ${target.username || target.id}`, `${result.record.reason}\nID: ${result.record.id}`, guildId).catch(() => undefined);
    return replyModal(modal.submit, `OK: reclamatia a fost salvata cu ID \`${result.record.id}\`.`, deps.MessageFlags.Ephemeral);
  }

  async function list(interaction: DiscordInteraction, guildId: string, kind: "bugs" | "users"): Promise<unknown> {
    await deps.safeDefer(interaction, true);
    const rows: Array<BugReportRecord | UserComplaintRecord> = kind === "bugs" ? await deps.listBugs(guildId) : await deps.listComplaints(guildId);
    if (!rows.length) return deps.safeEdit(interaction, kind === "bugs" ? "Nu exista rapoarte de bug." : "Nu exista reclamatii impotriva membrilor.");
    const render = (page: number, totalPages: number) => [{
      title: kind === "bugs" ? "Rapoarte de bug" : "Reclamatii impotriva membrilor",
      color: 0xe67e22,
      description: rows.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE).map(record => kind === "bugs" ? bugLine(record as BugReportRecord) : complaintLine(record as UserComplaintRecord)).join("\n\n"),
      footer: { text: `Pagina ${page + 1}/${totalPages}` }
    }];
    const message = await deps.safeEdit(interaction, { embeds: render(0, Math.ceil(rows.length / REPORT_PAGE_SIZE)) });
    if (message && interaction.user?.id) await deps.handlePagination(message, interaction.user.id, `report_${kind}`, rows, REPORT_PAGE_SIZE, render);
    return message;
  }

  async function remove(interaction: DiscordInteraction, guildId: string, kind: "bug" | "user"): Promise<unknown> {
    await deps.safeDefer(interaction, true);
    const id = String(interaction.options.getString("id", true) || "").trim();
    const removed = kind === "bug" ? await deps.removeBug(guildId, id) : await deps.removeComplaint(guildId, id);
    return deps.safeEdit(interaction, removed ? `OK: intrarea \`${id}\` a fost stearsa din lista ${kind === "bug" ? "de buguri" : "de reclamatii"}.` : `Nu exista ID-ul \`${id}\` in lista selectata.`);
  }

  async function handle(interaction: DiscordInteraction, games: GameConfig[]): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return interaction.reply?.({ content: "Eroare: /report este guild-only.", flags: deps.MessageFlags.Ephemeral });
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);
    if (group === "list") return list(interaction, guildId, subcommand === "users" ? "users" : "bugs");
    if (group === "remove") return remove(interaction, guildId, subcommand === "user" ? "user" : "bug");
    return subcommand === "complaint" ? complaint(interaction, guildId) : bug(interaction, games, guildId);
  }

  return { handle };
}

function buildReportCommandHandler(target: ReportHandlerDeps) {
  const reports = createReportInteractionHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => matchesCommand(interaction, { commandNames: ["report"] }),
    handle: async (interaction, games) => {
      try {
        return await reports.handle(interaction, games as GameConfig[]);
      } catch (error: unknown) {
        target.logger("ERROR", "REPORT_INTERACTION", "Eroare la /report", errorDetail(error));
        const payload = { content: "Eroare: raportul nu a putut fi procesat.", flags: target.MessageFlags.Ephemeral };
        if ((interaction.deferred || interaction.replied) && interaction.followUp) return interaction.followUp(payload);
        return interaction.reply?.(payload);
      }
    }
  };
  return { reports, ...command };
}

export default { createReportInteractionHandler, buildCommandHandler: buildReportCommandHandler };
