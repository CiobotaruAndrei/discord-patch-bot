"use strict";

import { createNativeInspectorClient } from "./nativeInspectorProcess.js";
import {
  decideIsolation,
  findInspectorBinary,
  inspectorBinaryCandidates,
  readIsolationSetting,
  readProcessCount
} from "./nativeInspectorRouting.js";
import type { InspectorLogger } from "./nativeInspectorProcess.js";
import type { IsolationSetting } from "./nativeInspectorRouting.js";
import type { InspectorMetricRecorder } from "../../shared/metricRecorderPorts.js";
import type { InspectionLimits, InspectionReport } from "./passiveArchiveInspection.js";

export interface IsolatedInspectorClient {
  inspect(
    content: Buffer,
    filename: string,
    mime: string,
    mode: string,
    limits: InspectionLimits
  ): Promise<{ report: InspectionReport | null; sandboxed: boolean; failure: string }>;
  stop(): void;
}

export interface IsolatedInspectionDeps {
  setting: IsolationSetting;
  platform: string;
  production: boolean;
  binaryPath: string | null;
  processCount: number;
  createClient(binaryPath: string): IsolatedInspectorClient;
  logger?: InspectorLogger;
}

export interface IsolatedInspectionRouter {
  isolated: boolean;
  reason: string;
  inspect(
    content: Buffer,
    filename: string,
    mime: string,
    mode: string,
    limits: InspectionLimits
  ): Promise<InspectionReport | null>;
  stop(): void;
}

export function createIsolatedInspectionRouter(deps: IsolatedInspectionDeps): IsolatedInspectionRouter {
  const decision = decideIsolation({
    setting: deps.setting,
    platform: deps.platform,
    production: deps.production,
    binaryPath: deps.binaryPath
  });
  const binaryPath = deps.binaryPath;
  const clients: IsolatedInspectorClient[] = [];
  const idle: IsolatedInspectorClient[] = [];
  const waiting: Array<(client: IsolatedInspectorClient) => void> = [];

  function acquire(): Promise<IsolatedInspectorClient> {
    const free = idle.pop();
    if (free) return Promise.resolve(free);
    if (binaryPath && clients.length < deps.processCount) {
      const created = deps.createClient(binaryPath);
      clients.push(created);
      return Promise.resolve(created);
    }
    return new Promise(resolve => { waiting.push(resolve); });
  }

  function release(client: IsolatedInspectorClient): void {
    const next = waiting.shift();
    if (next) next(client);
    else idle.push(client);
  }

  async function inspect(
    content: Buffer,
    filename: string,
    mime: string,
    mode: string,
    limits: InspectionLimits
  ): Promise<InspectionReport | null> {
    if (!decision.isolated) return null;
    const client = await acquire();
    let outcome: { report: InspectionReport | null; failure: string };
    try {
      outcome = await client.inspect(content, filename, mime, mode, limits);
    } catch (error) {
      release(client);
      deps.logger?.("WARN", "NATIVE-INSPECTOR", "Procesul izolat a aruncat; inspectia cade pe parserul TypeScript", error);
      return null;
    }
    release(client);
    if (outcome.report) return outcome.report;
    deps.logger?.(
      "WARN",
      "NATIVE-INSPECTOR",
      "Procesul izolat nu a produs verdict; inspectia cade pe parserul TypeScript, nu pe addon-ul in-proces",
      outcome.failure
    );
    return null;
  }

  function stop(): void {
    for (const client of clients) client.stop();
    clients.length = 0;
    idle.length = 0;
    waiting.length = 0;
  }

  return { isolated: decision.isolated, reason: decision.reason, inspect, stop };
}

let router: IsolatedInspectionRouter | null = null;
let attachedMetrics: InspectorMetricRecorder | undefined;
let attachedLogger: InspectorLogger | undefined;

function routerFromEnvironment(): IsolatedInspectionRouter {
  const binaryPath = findInspectorBinary(
    inspectorBinaryCandidates(import.meta.url, process.env.NATIVE_INSPECTOR_BINARY)
  );
  return createIsolatedInspectionRouter({
    setting: readIsolationSetting(process.env.NATIVE_INSPECTOR_ISOLATION),
    platform: process.platform,
    production: process.env.NODE_ENV === "production",
    binaryPath,
    processCount: readProcessCount(process.env.NATIVE_INSPECTOR_PROCESSES),
    createClient: path => createNativeInspectorClient({ binaryPath: path, metrics: attachedMetrics, logger: attachedLogger }),
    logger: attachedLogger
  });
}

function activeRouter(): IsolatedInspectionRouter {
  if (!router) router = routerFromEnvironment();
  return router;
}

export function attachIsolatedInspection(options: { metrics?: InspectorMetricRecorder; logger?: InspectorLogger }): void {
  router?.stop();
  router = null;
  attachedMetrics = options.metrics;
  attachedLogger = options.logger;
}

export function isolatedInspectionStatus(): { isolated: boolean; reason: string } {
  const active = activeRouter();
  return { isolated: active.isolated, reason: active.reason };
}

export function inspectInIsolatedProcess(
  content: Buffer,
  filename: string,
  mime: string,
  mode: string,
  limits: InspectionLimits
): Promise<InspectionReport | null> {
  return activeRouter().inspect(content, filename, mime, mode, limits);
}

export function stopIsolatedInspection(): void {
  router?.stop();
  router = null;
}
