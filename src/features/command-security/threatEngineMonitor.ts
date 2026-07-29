"use strict";

import type { ThreatEngineMetricRecorder } from "../../app/health/metricRecorders.js";
import type { ReputationEngineDetails } from "./reputationEngine.js";

type MonitorLogger = (level: string, context: string, message: string, meta?: unknown) => void;

export interface ThreatEngineMonitorDeps {
  metrics: ThreatEngineMetricRecorder;
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
      metrics.scanned(now());
      const { engine: previousEngine, database: previousDatabase } = metrics.knownVersions();
      const engineChanged = details.engineVersion !== "" && details.engineVersion !== previousEngine;
      const databaseChanged = details.databaseVersion !== "" && details.databaseVersion !== previousDatabase;
      if (engineChanged || databaseChanged) {
        const firstObservation = previousEngine === "" && previousDatabase === "";
        if (!firstObservation) metrics.versionChanged();
        logger?.("INFO", "THREAT_REPUTATION", "Versiunea motorului de reputatie/antivirus observata s-a schimbat", {
          engineVersion: { from: previousEngine || null, to: details.engineVersion || previousEngine || null },
          databaseVersion: { from: previousDatabase || null, to: details.databaseVersion || previousDatabase || null }
        });
      }
      metrics.versionsObserved({ engine: details.engineVersion, database: details.databaseVersion });
    },
    onFailure(reason: string): void {
      metrics.probeFailed(reason);
    }
  };
}
