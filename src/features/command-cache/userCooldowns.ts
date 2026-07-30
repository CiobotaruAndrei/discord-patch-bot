import type { CooldownResult } from "./cooldownTypes.js";

const USER_COOLDOWNS_THRESHOLD = 500;
const COOLDOWN_CLEAN_EVERY_N_INSERTS = 100;
const USER_COOLDOWNS_HARD_MAX = USER_COOLDOWNS_THRESHOLD * 10;

export interface UserCooldownsDeps {
  USER_COMMAND_COOLDOWN_MS: number;
}

export function createUserCooldowns({ USER_COMMAND_COOLDOWN_MS }: UserCooldownsDeps) {
  const userCommandCooldowns = new Map<string, number>();
  let cooldownInsertCounter = 0;

  function checkUserCooldown(userId: unknown, command: string): CooldownResult {
    if (USER_COMMAND_COOLDOWN_MS === 0) return { allowed: true };
    const key = `${userId}:${command}`;
    const last = userCommandCooldowns.get(key) || 0;
    const now = Date.now();
    const elapsed = now - last;
    if (elapsed < USER_COMMAND_COOLDOWN_MS) {
      return { allowed: false, remainingMs: USER_COMMAND_COOLDOWN_MS - elapsed };
    }

    userCommandCooldowns.delete(key);
    userCommandCooldowns.set(key, now);
    if (userCommandCooldowns.size > USER_COOLDOWNS_THRESHOLD) {
      cooldownInsertCounter++;
      if (cooldownInsertCounter >= COOLDOWN_CLEAN_EVERY_N_INSERTS) {
        cooldownInsertCounter = 0;
        cleanUserCooldowns();
      }
    }
    return { allowed: true };
  }

  function cleanUserCooldowns(): void {
    if (USER_COMMAND_COOLDOWN_MS === 0) {
      userCommandCooldowns.clear();
      return;
    }
    const now = Date.now();
    for (const [key, ts] of userCommandCooldowns.entries()) {
      if (now - ts > USER_COMMAND_COOLDOWN_MS * 2) userCommandCooldowns.delete(key);
    }

    if (userCommandCooldowns.size > USER_COOLDOWNS_HARD_MAX) {
      let excess = userCommandCooldowns.size - USER_COOLDOWNS_THRESHOLD;
      for (const key of userCommandCooldowns.keys()) {
        if (excess <= 0) break;
        userCommandCooldowns.delete(key);
        excess--;
      }
    }
  }

  function getUserCooldownsSize(): number {
    return userCommandCooldowns.size;
  }

  return { checkUserCooldown, cleanUserCooldowns, getUserCooldownsSize };
}
