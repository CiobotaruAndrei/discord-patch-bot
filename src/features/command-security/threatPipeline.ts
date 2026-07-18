"use strict";

import type { ThreatResource, ThreatVerdict } from "./threatInspection.js";
import { bindThreatVerdict, selectThreatResources } from "./threatInspection.js";

export type ThreatAnalysisState = "clean" | "suspicious" | "confirmed" | "uncertain" | "partial" | "unsupported" | "risky-file";

export type ThreatAnalysis = {
  state: ThreatAnalysisState;
  complete: boolean;
  reason: string;
  resources: ThreatResource[];
};

const RISKY_FILE = /\.(?:exe|dll|scr|bat|cmd|ps1|js|vbs|jar|zip|rar|7z|iso)$/i;
const SUSPICIOUS_CONTENT = /(?:discord(?:app)?\.com\/invite\/|discord\.gg\/|@everyone|@here)/i;

export function analyzeThreatInput(input: {
  content?: string;
  attachments?: ThreatResource[];
  urls?: ThreatResource[];
  verdict?: ThreatVerdict | null;
  downloadedBytes?: Uint8Array;
}): ThreatAnalysis {
  const resources = selectThreatResources(input.attachments ?? [], input.urls ?? []);
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
