"use strict";

import type { ComponentCollector, InteractionMessage, NotificationMode } from "../../types.js";
import type { ActionRowComponent, ButtonComponent, PresentationLogger } from "./presentationContracts.js";
import { errorMessage } from "../../shared/errors.js";

export interface PaginationControlsDeps {
  crypto: {
    randomBytes(size: number): { toString(encoding: BufferEncoding): string };
  };
  ActionRowBuilder: new () => ActionRowComponent;
  ButtonBuilder: new () => ButtonComponent;
  ButtonStyle: { Primary: unknown; Secondary: unknown };
  ComponentType: { Button: unknown };
  MessageFlags: { Ephemeral: number };
  COLLECTOR_TIMEOUT_MS: number;
  logger: PresentationLogger;
}

export function createPaginationControls({ crypto, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, COLLECTOR_TIMEOUT_MS, logger }: PaginationControlsDeps) {
  function generateSessionId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  function buildPaginationButtons(prefix: string, sessionId: string, page: number, totalPages: number): ActionRowComponent {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}_prev_${sessionId}`).setLabel("<- Ant").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId(`${prefix}_next_${sessionId}`).setLabel("Urm ->").setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1)
    );
  }

  async function handlePagination<TItem, TEmbed>(
    interactionMessage: InteractionMessage,
    authorId: string,
    prefix: string,
    items: TItem[],
    itemsPerPage: number,
    generateEmbedsFn: (currentPage: number, totalPages: number, mode: NotificationMode) => Promise<TEmbed[]> | TEmbed[],
    defaultMode: NotificationMode = "detailed"
  ): Promise<void> {
    if (!items || items.length === 0) return;
    let currentPage = 0;
    const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
    const sessionId = generateSessionId();
    let collector: ComponentCollector | null = null;

    const updateMessage = async (): Promise<boolean> => {
      try {
        const embeds = await generateEmbedsFn(currentPage, totalPages, defaultMode);
        await interactionMessage.edit({
          embeds,
          components: [buildPaginationButtons(prefix, sessionId, currentPage, totalPages)]
        }).catch((err: unknown) => {
          logger("WARN", "PAGINATION", `Eroare la edit-ul paginii (prefix=${prefix})`, errorMessage(err));
        });
        return true;
      } catch (err) {
        logger("WARN", "PAGINATION", `Eroare la generarea embed-urilor (prefix=${prefix})`, errorMessage(err));
        if (collector) collector.stop("error");
        return false;
      }
    };

    if (!(await updateMessage())) return;
    collector = interactionMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: COLLECTOR_TIMEOUT_MS
    });
    collector.on("collect", async (btn) => {
      if (btn.user.id !== authorId) {
        return btn.reply({ content: "Doar autorul comenzii poate naviga!", flags: MessageFlags.Ephemeral }).catch(() => null);
      }
      if (btn.customId !== `${prefix}_prev_${sessionId}` && btn.customId !== `${prefix}_next_${sessionId}`) return;
      currentPage += btn.customId === `${prefix}_next_${sessionId}` ? 1 : -1;
      currentPage = Math.max(0, Math.min(totalPages - 1, currentPage));
      await btn.deferUpdate().catch(() => null);
      await updateMessage();
    });
    collector.on("end", () => {
      if (interactionMessage.editable) {
        interactionMessage.edit({ components: [] }).catch((err: unknown) => {
          logger("WARN", "PAGINATION", `Eroare la cleanup-ul butoanelor (prefix=${prefix})`, errorMessage(err));
        });
      }
    });
  }

  return { generateSessionId, buildPaginationButtons, handlePagination };
}
