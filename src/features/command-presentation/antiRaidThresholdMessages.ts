"use strict";

import type { SetThresholdsOutcome } from "../command-security/setAntiRaidThresholdsUseCase.js";

export type ThresholdOutcome = SetThresholdsOutcome;

export function renderThresholdOutcome(
  outcome: ThresholdOutcome,
  formatError: (error: unknown) => string = () => "Eroare la salvarea pragurilor."
): string {
  if (outcome.kind === "nothing-provided") {
    return "Eroare: nu ai dat niciun prag de modificat. Optiunile nedate raman la valoarea curenta, deci comanda fara optiuni nu ar schimba nimic.";
  }
  if (outcome.kind === "read-failed") {
    return "Eroare: pragurile curente nu au putut fi citite, deci nu se poate calcula ce se schimba. Nimic nu a fost modificat; reincearca.";
  }
  if (outcome.kind === "save-failed") {
    return `Eroare: pragurile NU au fost salvate. ${formatError(outcome.error)} Valorile anterioare au ramas active.`;
  }

  const lines: string[] = [];
  if (outcome.applied.length > 0) {
    lines.push(`OK: praguri actualizate: ${outcome.applied.join(", ")}.`);
  }
  if (outcome.rejected.length > 0) {
    lines.push(
      `Refuzate (valorile valide de mai sus au fost salvate): ${outcome.rejected
        .map(rejection => `\`${rejection.key}\` ${rejection.reason}`)
        .join("; ")}.`
    );
  }
  if (lines.length === 0) {
    return "Eroare: niciun prag nu a fost acceptat, deci nimic nu s-a schimbat.";
  }
  return lines.join("\n");
}
