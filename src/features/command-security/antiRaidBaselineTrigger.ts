"use strict";

import type { ToggleProtectionOutcome } from "./toggleProtectionUseCase.js";

export interface BaselineTriggerDeps {
  captureRaidBaseline?: (guildId: string) => Promise<boolean>;
  logger?: (level: string, context: string, message: string, meta?: unknown) => void;
  errorDetail: (error: unknown) => string;
}

export async function captureBaselineOnStart(
  outcome: ToggleProtectionOutcome,
  command: string,
  subcommand: string,
  guildId: string,
  deps: BaselineTriggerDeps
): Promise<boolean> {
  if (outcome.kind !== "toggled" || command !== "start" || subcommand !== "anti-raid") return false;
  if (!deps.captureRaidBaseline) return false;

  const captured = await deps.captureRaidBaseline(guildId).catch((error: unknown) => {
    deps.logger?.("WARN", "SECURITY_COMMAND", "Baseline-ul anti-raid nu a putut fi capturat la pornire", deps.errorDetail(error));
    return false;
  });

  if (!captured) {
    deps.logger?.("WARN", "SECURITY_COMMAND", "Anti-raid a pornit fara baseline curat; recovery va porni de la starea de la confirmare", { guildId });
  }
  return captured;
}
