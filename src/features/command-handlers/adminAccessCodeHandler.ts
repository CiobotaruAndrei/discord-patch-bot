"use strict";

import * as crypto from "node:crypto";
import type { CommandGame, CommandHandler } from "../command-registry/commandHandler";

import { errorDetail } from "../../shared/errors";
import { handledCommandError } from "../command-security/commandOutcome";

const ACCESS_CODE_GRANT_TTL_MS = 30 * 60 * 1000;
const MIN_ACCESS_CODE_LENGTH = 8;

type InteractionPayload = string | { content: string; flags?: number };

type DiscordInteraction = {
  commandName?: string;
  guild?: { id?: string } | null;
  user?: { id?: string } | null;
  deferred?: boolean;
  replied?: boolean;
  options: {
    getSubcommand(required?: boolean): string;
    getString(name: string, required?: boolean): string | null;
  };
  isChatInputCommand?: () => boolean;
  reply?: (payload: InteractionPayload) => Promise<unknown>;
  followUp?: (payload: InteractionPayload) => Promise<unknown>;
};

type AdminAccessCodeGrant = {
  userId?: string | null;
  grantedAt?: Date | string | null;
  expiresAt?: Date | string | null;
};

type GuildAdminAccessCodeDoc = {
  adminAccessCodeGrants?: AdminAccessCodeGrant[] | null;
};

type GuildFindQuery = {
  lean(): Promise<GuildAdminAccessCodeDoc | null>;
};

type GuildModelLike = {
  updateOne(filter: object, update: object | readonly object[], options?: object): Promise<unknown>;
  findOne(filter: object): GuildFindQuery | Promise<GuildAdminAccessCodeDoc | null>;
};

type Logger = (level: string, context: string, message: string, meta?: string) => void;

type AdminAccessCodeDeps = {
  GuildModel: GuildModelLike;
  invalidateGuildCache(guildId: string): void;
  safeDefer(interaction: DiscordInteraction, ephemeral?: boolean): Promise<void>;
  safeEdit(interaction: DiscordInteraction, payload: InteractionPayload): Promise<unknown>;
  logger: Logger;
  MessageFlags: { Ephemeral: number };
};

type AdminAccessCodeContext = AdminAccessCodeDeps & {
  handleInteraction?: (interaction: DiscordInteraction, games: CommandGame[]) => Promise<unknown> | unknown;
};

function hasLean(result: GuildFindQuery | Promise<GuildAdminAccessCodeDoc | null>): result is GuildFindQuery {
  return "lean" in result && typeof result.lean === "function";
}

async function loadAdminAccessCodeDoc(GuildModel: GuildModelLike, guildId: string): Promise<GuildAdminAccessCodeDoc | null> {
  const result = GuildModel.findOne({ _id: guildId });
  return hasLean(result) ? result.lean() : result;
}

function configuredAdminAccessCodes(env: Record<string, string | undefined> = process.env): string[] {
  return String(env.BOT_ADMIN_ACCESS_CODES || "")
    .split(",")
    .map(value => value.trim())
    .filter(value => value.length >= MIN_ACCESS_CODE_LENGTH);
}

function timingSafeStringEqual(leftValue: string, rightValue: string): boolean {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isConfiguredAdminAccessCode(code: string): boolean {
  const normalized = code.trim();
  return Boolean(normalized) && configuredAdminAccessCodes().some(candidate => timingSafeStringEqual(normalized, candidate));
}

function expiresAtMs(value: Date | string | null | undefined): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeGrantForUser(
  grants: readonly AdminAccessCodeGrant[] | null | undefined,
  userId: string,
  now = new Date()
): AdminAccessCodeGrant | null {
  if (!userId || !Array.isArray(grants)) return null;
  const nowMs = now.getTime();
  return grants.find(grant => grant?.userId === userId && (expiresAtMs(grant.expiresAt) ?? 0) > nowMs) || null;
}

function buildGrantUpdate(userId: string, grantedAt: Date, expiresAt: Date): readonly object[] {
  return [{
    $set: {
      adminAccessCodeGrants: {
        $concatArrays: [
          {
            $filter: {
              input: { $ifNull: ["$adminAccessCodeGrants", []] },
              as: "grant",
              cond: { $ne: ["$$grant.userId", userId] }
            }
          },
          [{ userId, grantedAt, expiresAt }]
        ]
      }
    }
  }];
}

function createAdminAccessCodeHandler(deps: AdminAccessCodeDeps) {
  const { GuildModel, invalidateGuildCache, safeDefer, safeEdit } = deps;

  async function handleUnlock(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const code = interaction.options.getString("code", true) || "";
    if (!configuredAdminAccessCodes().length) {
      return safeEdit(interaction, { content: "Codul de acces admin nu este configurat pentru bot.", flags: deps.MessageFlags.Ephemeral });
    }
    if (!isConfiguredAdminAccessCode(code)) {
      return safeEdit(interaction, { content: "Access denied.", flags: deps.MessageFlags.Ephemeral });
    }
    const userId = interaction.user?.id || "";
    if (!userId) return safeEdit(interaction, { content: "Eroare: nu pot identifica userul Discord.", flags: deps.MessageFlags.Ephemeral });
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + ACCESS_CODE_GRANT_TTL_MS);
    await GuildModel.updateOne({ _id: guildId }, buildGrantUpdate(userId, grantedAt, expiresAt), { upsert: true });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, {
      content: `Access granted. Codul admin este activ pana la ${expiresAt.toISOString()}.`,
      flags: deps.MessageFlags.Ephemeral
    });
  }

  async function handleStatus(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const userId = interaction.user?.id || "";
    const doc = await loadAdminAccessCodeDoc(GuildModel, guildId);
    const grant = activeGrantForUser(doc?.adminAccessCodeGrants, userId);
    if (!grant) {
      return safeEdit(interaction, { content: "Acces admin prin cod: inactiv.", flags: deps.MessageFlags.Ephemeral });
    }
    return safeEdit(interaction, {
      content: `Acces admin prin cod: activ pana la ${String(grant.expiresAt)}.`,
      flags: deps.MessageFlags.Ephemeral
    });
  }

  async function handleRevoke(interaction: DiscordInteraction, guildId: string): Promise<unknown> {
    const userId = interaction.user?.id || "";
    if (!userId) return safeEdit(interaction, { content: "Eroare: nu pot identifica userul Discord.", flags: deps.MessageFlags.Ephemeral });
    await GuildModel.updateOne({ _id: guildId }, { $pull: { adminAccessCodeGrants: { userId } } }, { upsert: true });
    invalidateGuildCache(guildId);
    return safeEdit(interaction, { content: "OK: accesul admin prin cod a fost revocat pentru userul tau.", flags: deps.MessageFlags.Ephemeral });
  }

  async function handleAdminAccessCode(interaction: DiscordInteraction): Promise<unknown> {
    const guildId = interaction.guild?.id || "";
    if (!guildId) return undefined;
    await safeDefer(interaction, true);
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "unlock") return handleUnlock(interaction, guildId);
    if (subcommand === "status") return handleStatus(interaction, guildId);
    if (subcommand === "revoke") return handleRevoke(interaction, guildId);
    return safeEdit(interaction, { content: "Eroare: subcomanda admin-access nu este recunoscuta.", flags: deps.MessageFlags.Ephemeral });
  }

  return { handleAdminAccessCode };
}

function isAdminAccessCodeCommand(interaction: unknown): interaction is DiscordInteraction {
  if (!interaction || typeof interaction !== "object") return false;
  const candidate = interaction as Partial<DiscordInteraction>;
  return candidate.isChatInputCommand?.() === true && Boolean(candidate.guild) && candidate.commandName === "admin-access";
}

function buildAdminAccessCodeCommandHandler(target: AdminAccessCodeContext) {
  const handlers = createAdminAccessCodeHandler(target);
  const command: CommandHandler<DiscordInteraction> = {
    canHandle: isAdminAccessCodeCommand,
    handle: async interaction => {
      try {
        return await handlers.handleAdminAccessCode(interaction);
      } catch (err) {
        target.logger("ERROR", "ADMIN_ACCESS_CODE", "Eroare la comanda admin-access", errorDetail(err));
        const payload = { content: "Eroare: nu am putut procesa accesul admin prin cod.", flags: target.MessageFlags.Ephemeral };
        try {
          if ((interaction.deferred || interaction.replied) && typeof interaction.followUp === "function") {
            await interaction.followUp(payload);
          } else if (typeof interaction.reply === "function") {
            await interaction.reply(payload);
          }
        } catch {}
        return handledCommandError(errorDetail(err));
      }
    }
  };
  return { handlers, ...command };
}

type AdminAccessCodeInstaller = {
  (target: AdminAccessCodeContext): void;
  createAdminAccessCodeHandler: typeof createAdminAccessCodeHandler;
  buildCommandHandler: typeof buildAdminAccessCodeCommandHandler;
  activeGrantForUser: typeof activeGrantForUser;
  configuredAdminAccessCodes: typeof configuredAdminAccessCodes;
};

const installAdminAccessCodeHandler: AdminAccessCodeInstaller = (target: AdminAccessCodeContext): void => {
  const previousHandleInteraction = target.handleInteraction;
  const { handlers, canHandle, handle } = buildAdminAccessCodeCommandHandler(target);
  async function handleInteraction(interaction: DiscordInteraction, games: CommandGame[]) {
    if (!canHandle(interaction)) {
      if (typeof previousHandleInteraction === "function") return previousHandleInteraction(interaction, games);
      return undefined;
    }
    return handle(interaction, games);
  }
  Object.assign(target, handlers, { handleInteraction });
};

installAdminAccessCodeHandler.createAdminAccessCodeHandler = createAdminAccessCodeHandler;
installAdminAccessCodeHandler.buildCommandHandler = buildAdminAccessCodeCommandHandler;
installAdminAccessCodeHandler.activeGrantForUser = activeGrantForUser;
installAdminAccessCodeHandler.configuredAdminAccessCodes = configuredAdminAccessCodes;

export = installAdminAccessCodeHandler;
