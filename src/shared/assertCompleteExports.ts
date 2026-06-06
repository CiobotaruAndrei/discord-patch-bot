export function assertNoUndefinedExports<T extends Record<string, unknown>>(exports: T, label: string): T {
  const missing = Object.keys(exports).filter(key => exports[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `${label}: dependinte negasite in wiring (valoare undefined): ${missing.join(", ")}. ` +
      "Un installer nu a scris aceste campuri pe context sau lipsesc din lista de export."
    );
  }
  return exports;
}
