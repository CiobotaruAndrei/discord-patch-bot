const nativeFallbackTotals = new Map<string, number>();
const nativeFallbackLastLogged = new Map<string, number>();
const NATIVE_FALLBACK_LOG_THROTTLE_MS = 60_000;

export const NATIVE_FALLBACK_FUNCTIONS = [
  "classifyPatchNote",
  "scoreListingCandidate",
  "rankListingCandidates",
  "extractAndRankListingCandidates",
  "chooseBestSteamMatch",
  "isGoodSteamArticleUrl",
  "extractDateScore",
  "inspectUntrustedContent",
  "inspectMagic",
  "scanYara"
];

export function recordNativeFallback(fnName: string, err: unknown): void {
  const total = (nativeFallbackTotals.get(fnName) || 0) + 1;
  nativeFallbackTotals.set(fnName, total);
  const now = Date.now();
  const last = nativeFallbackLastLogged.get(fnName) || 0;
  if (now - last >= NATIVE_FALLBACK_LOG_THROTTLE_MS) {
    nativeFallbackLastLogged.set(fnName, now);
    console.warn(
      `[NATIVE_FUZZY] Apelul nativ \`${fnName}\` a esuat — folosesc fallback TypeScript (total ${total}). `
      + "Risc de divergenta de rezultat/performanta fata de Rust; verifica build-ul nativ.",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export function getNativeFallbackTotals(): Record<string, number> {
  return Object.fromEntries(nativeFallbackTotals);
}

export function getNativeFallbackTotal(): number {
  let sum = 0;
  for (const value of nativeFallbackTotals.values()) sum += value;
  return sum;
}

export function resetNativeFallbackTotals(): void {
  nativeFallbackTotals.clear();
  nativeFallbackLastLogged.clear();
}
