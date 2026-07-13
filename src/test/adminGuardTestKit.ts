import { createRequire as __createRequire } from "node:module";
const require = __createRequire(import.meta.url);
import assert from "node:assert/strict";

export type TestInteraction = {
  commandName: string;
  guild: {
    id: string;
    ownerId?: string | null;
    fetchOwner?: () => Promise<{ id?: string; user?: { id?: string } | null } | null>;
    roles?: { cache?: { has: (roleId: string) => boolean; get?: (roleId: string) => { position?: number } | undefined } };
  } | null;
  user?: { id: string };
  globalAccessCodeAuthorized?: boolean;
  deferred: boolean;
  replied: boolean;
  isChatInputCommand: () => boolean;
  memberPermissions: { has: (permission?: unknown) => boolean };
  member?: { roles?: { has?: (roleId: string) => boolean; cache?: { has: (roleId: string) => boolean }; highest?: { position?: number } } | readonly string[] };
  options?: {
    getSubcommand?: (required?: boolean) => string;
    getSubcommandGroup?: (required?: boolean) => string | null;
  };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
  deferReply?: (payload?: unknown) => Promise<void>;
  editReply?: (payload: unknown) => Promise<void>;
  showModal?: (modal: unknown) => Promise<void>;
  awaitModalSubmit?: (options: { filter: (interaction: TestModalSubmit) => boolean; time: number }) => Promise<TestModalSubmit>;
};
export type TestGame = { key: string };
export type TestModalSubmit = {
  customId: string;
  user: { id: string };
  deferred: boolean;
  replied: boolean;
  fields: { getTextInputValue: (customId: string) => string };
  reply: (payload: unknown) => Promise<void>;
  followUp: (payload: unknown) => Promise<void>;
  deferReply: (payload?: unknown) => Promise<void>;
  editReply: (payload: unknown) => Promise<void>;
};

export type AdminGuardModule = ((interaction: TestInteraction) => Promise<boolean>) & {
  ADMIN_REQUIRED_MESSAGE: string;
  isGuildAdmin: (interaction: TestInteraction) => boolean;
  hasAllowedAdminRole: (interaction: TestInteraction) => boolean;
  hasConfiguredAdminRole: (interaction: TestInteraction, config: { mode?: "role" | "role-or-higher" | null; roleId?: string | null } | null) => boolean;
};

export type AdminCommandGuardModule = {
  createAdminCommandGuard: (deps: { requireGuildAdmin: (interaction: TestInteraction) => Promise<boolean>; authorizeGuildAdmin?: (interaction: TestInteraction) => Promise<TestInteraction | null> }, target?: Record<string, unknown>) => {
    handleAdminProtectedCommand: (
      interaction: TestInteraction,
      games: TestGame[],
      next?: (interaction: TestInteraction, games: TestGame[]) => Promise<unknown>
    ) => Promise<unknown>;
  };
  requireGuildAdminWithConfiguredAccess: (target: Record<string, unknown>, interaction: TestInteraction) => Promise<boolean>;
  authorizeGuildAdminWithConfiguredAccess: (target: Record<string, unknown>, interaction: TestInteraction) => Promise<TestInteraction | null>;
  isAdminProtectedCommand: (interaction: TestInteraction) => boolean;
  isSensitiveAdminCommand: (interaction: TestInteraction) => boolean;
  hasSensitiveUserAccess: (interaction: TestInteraction) => boolean;
  isOwnerOnlyAdminAccessCommand: (interaction: TestInteraction) => boolean;
  isGuildOwner: (interaction: TestInteraction) => Promise<boolean>;
};

export const requireGuildAdmin = require("../features/command-security/adminPermissionGuard").default as AdminGuardModule;
export const adminCommandGuard = require("../features/command-security/adminCommandRouterGuard").default as AdminCommandGuardModule;

type GuardedTarget = Record<string, unknown> & {
  handleInteraction: (interaction: TestInteraction, games: TestGame[]) => Promise<unknown>;
};

export function buildGuardedHandleInteraction(target: GuardedTarget) {
  const next = target.handleInteraction;
  const guard = adminCommandGuard.createAdminCommandGuard({
    requireGuildAdmin: interaction => adminCommandGuard.requireGuildAdminWithConfiguredAccess(target, interaction),
    authorizeGuildAdmin: interaction => adminCommandGuard.authorizeGuildAdminWithConfiguredAccess(target, interaction)
  }, target);
  return async (interaction: TestInteraction, games: TestGame[]) =>
    adminCommandGuard.isAdminProtectedCommand(interaction)
      ? guard.handleAdminProtectedCommand(interaction, games, next)
      : next(interaction, games);
}
export const globalAccessCode = require("../features/command-security/globalAccessCode").default as typeof import("../features/command-security/globalAccessCode.js")["default"];

export function makeInteraction(isAdmin: boolean, deferred = false): { interaction: TestInteraction; replies: unknown[]; followUps: unknown[] } {
  const replies: unknown[] = [];
  const followUps: unknown[] = [];
  return {
    interaction: {
      commandName: "set",
      guild: { id: "guild-1" },
      user: { id: "user-1" },
      deferred,
      replied: false,
      isChatInputCommand: () => true,
      memberPermissions: { has: () => isAdmin },
      member: { roles: { has: (_roleId: string) => false } },
      options: {
        getSubcommand: () => "",
        getSubcommandGroup: () => null
      },
      reply: async (payload: unknown) => { replies.push(payload); },
      followUp: async (payload: unknown) => { followUps.push(payload); }
    },
    replies,
    followUps
  };
}

function modalCustomId(modal: unknown): string {
  const json = (modal as { toJSON?: () => { custom_id?: string } }).toJSON?.();
  return String(json?.custom_id || "");
}


export function attachAccessCodeModal(interaction: TestInteraction, code: string, modalReplies: unknown[], modalEdits: unknown[]): void {
  let customId = "";
  interaction.showModal = async modal => { customId = modalCustomId(modal); };
  interaction.awaitModalSubmit = async options => {
    const submit: TestModalSubmit = {
      customId,
      user: { id: interaction.user?.id || "" },
      deferred: false,
      replied: false,
      fields: { getTextInputValue: () => code },
      reply: async payload => { submit.replied = true; modalReplies.push(payload); },
      followUp: async payload => { modalReplies.push(payload); },
      deferReply: async () => { submit.deferred = true; },
      editReply: async payload => { modalEdits.push(payload); }
    };
    assert.equal(options.filter(submit), true);
    return submit;
  };
}

