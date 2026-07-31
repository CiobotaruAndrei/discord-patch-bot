import requireGuildAdmin from "../features/command-security/adminPermissionGuard.js";
import { moduleContext } from "./moduleContextStub.js";
import adminCommandGuard from "../features/command-security/adminCommandRouterGuard.js";
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


type GuardedTarget = Record<string, unknown> & {
  handleInteraction: (interaction: TestInteraction, games: TestGame[]) => Promise<unknown>;
};

type GuardContext = Parameters<typeof adminCommandGuard.createAdminCommandGuard>[1];
type GuardInteraction = Parameters<typeof adminCommandGuard.isAdminProtectedCommand>[0];
type GuardGames = Parameters<ReturnType<typeof adminCommandGuard.createAdminCommandGuard>["handleAdminProtectedCommand"]>[1];
type GuardNext = NonNullable<Parameters<ReturnType<typeof adminCommandGuard.createAdminCommandGuard>["handleAdminProtectedCommand"]>[2]>;

export function buildGuardedHandleInteraction(target: GuardedTarget) {
  const next = target.handleInteraction;
  const guardedNext: GuardNext = (interaction, games) => next(interaction as TestInteraction, games as TestGame[]);
  const context = moduleContext<NonNullable<GuardContext>>(target as Record<string, unknown>);
  const guard = adminCommandGuard.createAdminCommandGuard({
    requireGuildAdmin: interaction => adminCommandGuard.requireGuildAdminWithConfiguredAccess(context, interaction),
    authorizeGuildAdmin: interaction => adminCommandGuard.authorizeGuildAdminWithConfiguredAccess(context, interaction)
  }, context);
  return async (interaction: TestInteraction, games: TestGame[]) =>
    adminCommandGuard.isAdminProtectedCommand(moduleContext<GuardInteraction>(interaction as Record<string, unknown>))
      ? guard.handleAdminProtectedCommand(moduleContext<GuardInteraction>(interaction as Record<string, unknown>), games.map(game => moduleContext<GuardGames[number]>(game as Record<string, unknown>)), guardedNext)
      : next(interaction, games);
}
export { default as globalAccessCode } from "../features/command-security/globalAccessCode.js";

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

export { requireGuildAdmin, adminCommandGuard };
