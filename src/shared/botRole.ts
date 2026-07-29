import type { BotRole } from "../types.js";

const BOT_ROLES: readonly BotRole[] = ["all", "web", "worker"];

function resolveBotRole(raw: string | undefined): BotRole {
  const normalized = String(raw ?? "").trim().toLowerCase();
  return (BOT_ROLES as readonly string[]).includes(normalized) ? (normalized as BotRole) : "all";
}

function roleRunsSchedulers(role: BotRole): boolean {
  return role !== "web";
}

function roleRunsInteractions(role: BotRole): boolean {
  return role !== "worker";
}

const INTERACTION_INTENTS = ["Guilds", "GuildMembers", "GuildMessages", "MessageContent", "GuildModeration"] as const;
const SCHEDULER_ONLY_INTENTS = ["Guilds"] as const;

type GatewayIntentName = (typeof INTERACTION_INTENTS)[number];

function intentNamesForRole(role: BotRole): readonly GatewayIntentName[] {
  return roleRunsInteractions(role) ? INTERACTION_INTENTS : SCHEDULER_ONLY_INTENTS;
}

export {
  resolveBotRole,
  roleRunsSchedulers,
  roleRunsInteractions,
  intentNamesForRole,
  INTERACTION_INTENTS,
  SCHEDULER_ONLY_INTENTS,
  BOT_ROLES
};
export type { GatewayIntentName };
