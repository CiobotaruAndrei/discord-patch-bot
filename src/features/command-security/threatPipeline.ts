"use strict";

import type { ThreatResource, ThreatVerdict } from "./threatInspection.js";
import { bindThreatVerdict, selectThreatResources } from "./threatInspection.js";
import { inspectThreatBytes, type ThreatScanLimits } from "./threatArchiveInspector.js";

export type ThreatAnalysisState = "clean" | "suspicious" | "confirmed" | "uncertain" | "partial" | "unsupported" | "risky-file";

export type ThreatAnalysis = {
  state: ThreatAnalysisState;
  complete: boolean;
  reason: string;
  resources: ThreatResource[];
  telemetry?: {
    format?: string;
    entries?: number;
    decompressedBytes?: number;
    maxDepth?: number;
    limits?: ThreatScanLimits;
  };
};

const RISKY_FILE = /\.(?:exe|dll|scr|bat|cmd|ps1|js|vbs|jar|zip|rar|7z|iso)$/i;
const SUSPICIOUS_CONTENT = /(?:discord(?:app)?\.com\/invite\/|discord\.gg\/|@everyone|@here)/i;

export function analyzeThreatInput(input: {
  content?: string;
  attachments?: ThreatResource[];
  urls?: ThreatResource[];
  verdict?: ThreatVerdict | null;
  downloadedBytes?: Uint8Array;
  resourceName?: string;
  scanLimits?: Partial<ThreatScanLimits>;
}): ThreatAnalysis {
  const resources = selectThreatResources(input.attachments ?? [], input.urls ?? []);
  if (input.downloadedBytes) {
    const bound = input.verdict ? bindThreatVerdict(input.downloadedBytes, input.verdict) : null;
    if (bound?.complete && bound.confirmed) return { state: "confirmed", complete: true, reason: "scanarea externa confirma obiectul cu identitate verificata", resources };
    const inspection = inspectThreatBytes(input.downloadedBytes, input.resourceName ?? resources[0]?.name ?? resources[0]?.url ?? "", input.scanLimits);
    if (inspection.state === "suspicious") return {
      state: "suspicious",
      complete: inspection.complete,
      reason: inspection.reason,
      resources,
      telemetry: inspection
    };
    if (!inspection.complete) return {
      state: bound?.reason ? "uncertain" : inspection.state,
      complete: false,
      reason: bound?.reason ?? inspection.reason,
      resources,
      telemetry: inspection
    };
    if (bound && !bound.complete) return { state: "uncertain", complete: false, reason: bound.reason ?? "verdict extern incomplet", resources, telemetry: inspection };
    return { state: "clean", complete: true, reason: inspection.reason, resources, telemetry: inspection };
  }
  if (resources.some(resource => RISKY_FILE.test(resource.name ?? resource.url))) {
    return { state: "risky-file", complete: false, reason: "fișierul necesită scanare izolată", resources };
  }
  if (input.verdict && input.downloadedBytes) {
    const bound = bindThreatVerdict(input.downloadedBytes, input.verdict);
    if (!bound.complete) return { state: "uncertain", complete: false, reason: bound.reason ?? "verdict incomplet", resources };
    if (bound.confirmed) return { state: "confirmed", complete: true, reason: "scanare confirmată", resources };
  }
  if (resources.length > 0 && !input.verdict) return { state: "partial", complete: false, reason: "resursele nu au verdict extern", resources };
  if (SUSPICIOUS_CONTENT.test(input.content ?? "")) return { state: "suspicious", complete: true, reason: "pattern de invitație sau mențiune broadcast", resources };
  return { state: "clean", complete: true, reason: "nu au fost detectate indicatori locali", resources };
}

export type ExternalThreatScanner = (input: {
  bytes: Uint8Array;
  hash: string;
  resource: ThreatResource;
}) => Promise<ThreatVerdict | null>;

export async function analyzeThreatBytes(input: {
  bytes: Uint8Array;
  resource: ThreatResource;
  verdict?: ThreatVerdict | null;
  externalScanner?: ExternalThreatScanner;
  scanLimits?: Partial<ThreatScanLimits>;
}): Promise<ThreatAnalysis> {
  const local = analyzeThreatInput({
    attachments: [input.resource],
    downloadedBytes: input.bytes,
    verdict: input.verdict,
    resourceName: input.resource.name,
    scanLimits: input.scanLimits
  });
  if (local.complete || !input.externalScanner) return local;
  const hashBound = bindThreatVerdict(input.bytes, input.verdict);
  const verdict = await input.externalScanner({ bytes: input.bytes, hash: hashBound.hash, resource: input.resource }).catch(() => null);
  const verified = bindThreatVerdict(input.bytes, verdict);
  if (!verified.complete) return { ...local, state: "uncertain", complete: false, reason: verified.reason ?? local.reason };
  return {
    ...local,
    state: verified.confirmed ? "confirmed" : "clean",
    complete: true,
    reason: verified.confirmed ? "scanarea externa confirma obiectul cu identitate verificata" : "scanarea externa nu a confirmat continut periculos"
  };
}
