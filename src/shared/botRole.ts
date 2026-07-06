import type { BotRole } from "../types";

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

export { resolveBotRole, roleRunsSchedulers, roleRunsInteractions, BOT_ROLES };
