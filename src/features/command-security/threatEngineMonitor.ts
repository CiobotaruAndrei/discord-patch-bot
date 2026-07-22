"use strict";

import type { ReputationEngineDetails } from "./reputationEngine.js";

type MonitorMetrics = {
  threatEngineScans?: number;
  threatEngineFailures?: Record<string, number>;
  threatEngineVersionChanges?: number;
  threatEngineLastScanAt?: number;
  threatEngineVersion?: string;
  threatEngineDatabaseVersion?: string;
};

type MonitorLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface ThreatEngineMonitorDeps {
  metrics: MonitorMetrics;
  logger?: MonitorLogger;
  now?: () => number;
}

export interface ThreatEngineMonitor {
  onDetails: (details: ReputationEngineDetails) => void;
  onFailure: (reason: string) => void;
}

export const THREAT_ENGINE_FAILURE_REASONS = ["http-status", "transport"] as const;

export function createThreatEngineMonitor(deps: ThreatEngineMonitorDeps): ThreatEngineMonitor {
  const { metrics, logger } = deps;
  const now = deps.now ?? Date.now;

  return {
    onDetails(details: ReputationEngineDetails): void {
      metrics.threatEngineScans = (metrics.threatEngineScans ?? 0) + 1;
      metrics.threatEngineLastScanAt = now();
      const previousEngine = metrics.threatEngineVersion ?? "";
      const previousDatabase = metrics.threatEngineDatabaseVersion ?? "";
      const engineChanged = details.engineVersion !== "" && details.engineVersion !== previousEngine;
      const databaseChanged = details.databaseVersion !== "" && details.databaseVersion !== previousDatabase;
      if (engineChanged || databaseChanged) {
        const firstObservation = previousEngine === "" && previousDatabase === "";
        if (!firstObservation) {
          metrics.threatEngineVersionChanges = (metrics.threatEngineVersionChanges ?? 0) + 1;
        }
        logger?.("INFO", "THREAT_REPUTATION", "Versiunea motorului de reputatie/antivirus observata s-a schimbat", {
          engineVersion: { from: previousEngine || null, to: details.engineVersion || previousEngine || null },
          databaseVersion: { from: previousDatabase || null, to: details.databaseVersion || previousDatabase || null }
        });
      }
      if (details.engineVersion !== "") metrics.threatEngineVersion = details.engineVersion;
      if (details.databaseVersion !== "") metrics.threatEngineDatabaseVersion = details.databaseVersion;
    },
    onFailure(reason: string): void {
      const failures = metrics.threatEngineFailures ?? {};
      failures[reason] = (failures[reason] ?? 0) + 1;
      metrics.threatEngineFailures = failures;
    }
  };
}
