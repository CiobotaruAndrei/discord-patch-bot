"use strict";

import type { GuildSettings } from "../../types.js";
import type { CommandHandler } from "../command-registry/commandHandler.js";
import { matchesCommand } from "../command-registry/commandMatch.js";
import { buildNotificationContent } from "../notifications/notificationTemplate.js";
import { renderYouTubeMessageTemplate } from "../youtube/youtubeDeliveryPolicy.js";
import { invalidTemplatePlaceholders, templateSpecFor } from "../notifications/templateCatalog.js";
import { errorDetail } from "../../shared/errors.js";
import { createGuildSettingsRepository, type GuildSettingsRepository } from "../guild-config/guildSettingsRepository.js";

interface DiscordInteraction {
  commandName?: string;
  guild?: { id: string } | null;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand?(): boolean;
  reply?(payload: unknown): Promise<unknown>;
  followUp?(payload: unknown): Promise<unknown>;
  options: {
    getSubcommand(required?: boolean): string;
    getString(name: string, required?: boolean): string | null;
  };
}

interface TemplatePreviewDeps {
  logger(level: string, context: string, message: string, meta?: unknown): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: unknown): Promise<unknown>;
  getGuildSettings(guildId: string): Promise<GuildSettings | null>;
  GuildModel: { updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> };
  guildSettingsRepository?: GuildSettingsRepository;
  MessageFlags: { Ephemeral: number };
}

function activeTemplate(settings: GuildSettings | null, field: "updateMessageTemplate" | "discountMessageTemplate" | "youtubeMessageTemplate"): string | null {
  const value = settings?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createTemplatePreviewHandler(deps: TemplatePreviewDeps) {
  const settingsRepository = deps.guildSettingsRepository ?? createGuildSettingsRepository(deps.GuildModel);
  async function template(interaction: DiscordInteraction, guildId: string, settings: GuildSettings | null): Promise<unknown> {
    const subcommand = interaction.options.getSubcommand(false);
    const command = String(interaction.options.getString("command", true) || "").trim();
    const spec = templateSpecFor(command);
    if (!spec) return deps.safeEdit(interaction, `Comanda \`${command}\` nu suporta template personalizat.`);
    if (subcommand === "status") {
      const custom = activeTemplate(settings, spec.field);
      return deps.safeEdit(interaction, {
        embeds: [{
          title: `Template: ${spec.command}`,
          color: 0x5865f2,
          fields: [
            { name: "Activ", value: `\`${custom || spec.defaultTemplate || "fara text suplimentar"}\`` },
            { name: "Implicit", value: `\`${spec.defaultTemplate || "fara text suplimentar"}\`` },
            { name: "Placeholdere", value: spec.placeholders.map(value => `\`{${value}}\``).join(", ") || "niciunul" }
          ]
        }]
      });
    }
    if (subcommand === "reset") {
      await settingsRepository.setField(guildId, spec.field, null);
      return deps.safeEdit(interaction, `OK: template-ul pentru **${spec.command}** a revenit la valoarea implicita.`);
    }
    const text = String(interaction.options.getString("text", true) || "").trim();
    const invalid = invalidTemplatePlaceholders(text, spec.placeholders);
    if (invalid.length) return deps.safeEdit(interaction, `Eroare: placeholdere nepermise: ${invalid.map(value => `\`{${value}}\``).join(", ")}.`);
    if (!text) return deps.safeEdit(interaction, "Eroare: template-ul nu poate fi gol. Foloseste /template reset.");
    await settingsRepository.setField(guildId, spec.field, text.slice(0, spec.maxLength));
    return deps.safeEdit(interaction, `OK: template-ul pentru **${spec.command}** a fost actualizat.`);
  }

  async function preview(interaction: DiscordInteraction, settings: GuildSettings | null): Promise<unknown> {
    const command = String(interaction.options.getString("command", true) || "").trim();
    const spec = templateSpecFor(command);
    if (!spec) return deps.safeEdit(interaction, `Comanda \`${command}\` nu trimite notificari previzualizabile.`);
    const configuredTemplate = activeTemplate(settings, spec.field);
    if (spec.field === "youtubeMessageTemplate") {
      const missing = !settings?.youtubeNotificationChannelId ? "Configurare lipsa: canalul YouTube (/youtube notify channel)." : null;
      const content = renderYouTubeMessageTemplate(configuredTemplate, {
        channelId: "demo-channel",
        channelName: "Canal demonstrativ",
        channelUrl: "https://youtube.com/@demo",
        subscribedAt: new Date()
      }, {
        videoId: "demo-video",
        channelId: "demo-channel",
        channelName: "Canal demonstrativ",
        title: "Patch notes demonstrative",
        link: "https://youtube.com/watch?v=demo-video",
        publishedAt: new Date().toISOString(),
        thumbnail: "https://i.ytimg.com/vi/demo-video/hqdefault.jpg"
      });
      return deps.safeEdit(interaction, {
        content: [missing, content].filter(Boolean).join("\n"),
        embeds: [{ title: "Patch notes demonstrative", url: "https://youtube.com/watch?v=demo-video", color: 0xff0000, description: "Previzualizare YouTube fara livrare sau marcarea videoclipului." }]
      });
    }
    const isUpdate = spec.field === "updateMessageTemplate";
    const roleId = isUpdate ? settings?.notificationRoleId : settings?.discountRoleId;
    const rendered = buildNotificationContent(configuredTemplate, { count: isUpdate ? 2 : 3 }, roleId);
    const missingChannel = isUpdate ? !settings?.notificationChannelId : !settings?.discountChannelId;
    const missing = missingChannel ? `Configurare lipsa: ${isUpdate ? "/start updates" : "/start reduceri"}.` : null;
    return deps.safeEdit(interaction, {
      ...rendered,
      content: [missing, rendered.content].filter(Boolean).join("\n") || undefined,
      embeds: [{
        title: isUpdate ? "Update demonstrativ" : "Reducere demonstrativa",
        color: isUpdate ? 0x5865f2 : 0x2ecc71,
        description: isUpdate ? "Versiune 2.0 — modificari demonstrative." : "Reducere 50% — pret demonstrativ 19,99 EUR."
      }]
    });
  }

  async function handle(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id;
    if (!guildId) return undefined;
    await deps.safeDefer(interaction, true);
    const settings = await deps.getGuildSettings(guildId);
    return interaction.commandName === "template" ? template(interaction, guildId, settings) : preview(interaction, settings);
  }

  return { handle };
}

function isTemplateOrPreview(interaction: DiscordInteraction): boolean {
  return matchesCommand(interaction, { commandNames: ["template"] })
    || matchesCommand(interaction, { commandNames: ["notification"], subcommand: "preview" });
}

function buildTemplatePreviewHandler(target: TemplatePreviewDeps) {
  const suite = createTemplatePreviewHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: (interaction): interaction is DiscordInteraction => isTemplateOrPreview(interaction as DiscordInteraction),
    handle: async interaction => {
      try {
        return await suite.handle(interaction);
      } catch (error: unknown) {
        target.logger("ERROR", "TEMPLATE_PREVIEW", "Eroare la template sau preview", errorDetail(error));
        const payload = { content: "Eroare: operatia de template nu a putut fi finalizata.", flags: target.MessageFlags.Ephemeral };
        if ((interaction.deferred || interaction.replied) && interaction.followUp) return interaction.followUp(payload);
        return interaction.reply?.(payload);
      }
    }
  };
  return { suite, ...command };
}

export default { createTemplatePreviewHandler, buildCommandHandler: buildTemplatePreviewHandler };
