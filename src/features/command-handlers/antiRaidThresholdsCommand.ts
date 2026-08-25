"use strict";

import { isDurationOption, THRESHOLD_ALIAS_NAMES, THRESHOLD_OPTION_NAMES } from "../command-security/antiRaidThresholdOptions.js";
import { setAntiRaidThresholds } from "../command-security/setAntiRaidThresholdsUseCase.js";
import { renderThresholdOutcome } from "../command-presentation/antiRaidThresholdMessages.js";

import type { AntiRaidThresholds } from "../command-security/antiRaidThresholds.js";
import type { SecurityOptions } from "../command-security/securityInteractionContracts.js";

export interface AntiRaidThresholdsCommandDeps {
  readStored: () => { ok: true; stored: Record<string, unknown> | null | undefined } | { ok: false };
  persist: (thresholds: AntiRaidThresholds) => Promise<void>;
  onSaveFailure?: (error: unknown) => void;
  formatError: (error: unknown) => string;
}

export function readThresholdOptions(options: SecurityOptions): Record<string, unknown> {
  const provided: Record<string, unknown> = {};
  for (const optionName of [...THRESHOLD_OPTION_NAMES, ...THRESHOLD_ALIAS_NAMES]) {
    const value = isDurationOption(optionName)
      ? options.getString(optionName, false)
      : options.getInteger(optionName, false);
    if (value !== null && value !== undefined) provided[optionName] = value;
  }
  return provided;
}

export async function runAntiRaidThresholdsCommand(
  options: SecurityOptions,
  deps: AntiRaidThresholdsCommandDeps
): Promise<string> {
  const current = deps.readStored();
  if (!current.ok) return renderThresholdOutcome({ kind: "read-failed" }, deps.formatError);

  const outcome = await setAntiRaidThresholds(readThresholdOptions(options), {
    readStored: () => current.stored,
    persist: deps.persist
  });
  if (outcome.kind === "save-failed") deps.onSaveFailure?.(outcome.error);
  return renderThresholdOutcome(outcome, deps.formatError);
}
