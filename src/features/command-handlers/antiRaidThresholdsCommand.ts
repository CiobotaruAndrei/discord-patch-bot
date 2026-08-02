"use strict";

import { THRESHOLD_OPTION_NAMES } from "../command-security/antiRaidThresholdOptions.js";
import { setAntiRaidThresholds } from "../command-security/setAntiRaidThresholdsUseCase.js";
import { renderThresholdOutcome } from "../command-presentation/antiRaidThresholdMessages.js";

import type { AntiRaidThresholds } from "../command-security/antiRaidThresholds.js";
import type { SecurityOptions } from "../command-security/securityInteractionContracts.js";

export interface AntiRaidThresholdsCommandDeps {
  readStored: () => Record<string, unknown> | null | undefined;
  persist: (thresholds: AntiRaidThresholds) => Promise<void>;
  onSaveFailure?: (error: unknown) => void;
  formatError: (error: unknown) => string;
}

export function readThresholdOptions(options: SecurityOptions): Record<string, unknown> {
  const provided: Record<string, unknown> = {};
  for (const optionName of THRESHOLD_OPTION_NAMES) {
    const value = options.getInteger(optionName, false) ?? options.getString(optionName, false);
    if (value !== null && value !== undefined) provided[optionName] = value;
  }
  return provided;
}

export async function runAntiRaidThresholdsCommand(
  options: SecurityOptions,
  deps: AntiRaidThresholdsCommandDeps
): Promise<string> {
  const outcome = await setAntiRaidThresholds(readThresholdOptions(options), {
    readStored: deps.readStored,
    persist: deps.persist
  });
  if (outcome.kind === "save-failed") deps.onSaveFailure?.(outcome.error);
  return renderThresholdOutcome(outcome, deps.formatError);
}
