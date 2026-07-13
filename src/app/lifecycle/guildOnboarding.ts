import type { LifecycleDiscordChannel, LifecycleDiscordGuild } from "./lifecycleContracts.js";
import { isSendableChannel } from "../../features/notifications/outboundChannel.js";
"use strict";

type Logger = (level: "INFO" | "WARN" | "ERROR", context: string, message: string, meta?: unknown) => void;
type CanSendEmbeds = (channel: LifecycleDiscordChannel, botId: string) => boolean;
type ErrorFormatter = (err: unknown) => string;

interface SendableChannel {
  send(payload: unknown): Promise<unknown>;
}

type OnboardingGuildLike = LifecycleDiscordGuild;

export interface OnboardingEmbed {
  title: string;
  description: string;
  color: number;
  footer: { text: string };
}

export function buildOnboardingEmbed(): OnboardingEmbed {
  const steps = [
    "**1.** `/start updates` — pe canalul unde vrei update-uri de jocuri.",
    "**2.** `/start reduceri` — pe canalul unde vrei alerte de reduceri.",
    "**3.** `/set games add` — alege ce jocuri urmaresti.",
    "**4.** `/set role updates` / `/set role discounts` — rol pingat la notificari (optional).",
    "**5.** `/help` — toate comenzile. `/history` — ce notificari am trimis deja."
  ];
  return {
    title: "Salut! Sunt botul de update-uri si reduceri 🎮",
    description: `Multumesc ca m-ai adaugat! Configurarea dureaza un minut:\n\n${steps.join("\n")}`,
    color: 0x5865f2,
    footer: { text: "Comenzile /start si /set cer permisiune de Administrator. Am nevoie de View Channel + Send Messages + Embed Links pe canalul de notificari." }
  };
}

export function selectOnboardingChannel(guild: OnboardingGuildLike, botId: string, canSend: CanSendEmbeds): SendableChannel | null {
  if (!botId) return null;
  const system = guild.systemChannel;
  if (system && canSend(system, botId) && isSendableChannel(system)) return system;
  const fallback = guild.channels?.cache?.find?.(channel => canSend(channel, botId) && isSendableChannel(channel));
  return isSendableChannel(fallback) ? fallback : null;
}

interface GuildOnboardingDeps {
  logger: Logger;
  canSendEmbeds: CanSendEmbeds;
  errorMessage: ErrorFormatter;
}

export function createGuildOnboarding(deps: GuildOnboardingDeps): { handleGuildCreate: (guild: OnboardingGuildLike) => Promise<void> } {
  const { logger, canSendEmbeds, errorMessage } = deps;

  async function handleGuildCreate(guild: OnboardingGuildLike): Promise<void> {
    try {
      const botId = guild.client?.user?.id;
      if (!botId) return;
      const channel = selectOnboardingChannel(guild, botId, canSendEmbeds);
      if (!channel) {
        logger("INFO", "ONBOARDING", `Guild nou ${guild.id || "?"}: niciun canal unde pot posta embed-ul de bun venit.`);
        return;
      }
      await channel.send({ embeds: [buildOnboardingEmbed()] });
      logger("INFO", "ONBOARDING", `Mesaj de bun venit trimis in guild-ul nou ${guild.id || "?"} (${guild.name || "?"}).`);
    } catch (err) {
      logger("WARN", "ONBOARDING", `Nu am putut trimite mesajul de bun venit pentru guild-ul ${guild.id || "?"}`, errorMessage(err));
    }
  }

  return { handleGuildCreate };
}
