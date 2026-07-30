import type { GameConfig } from "../../config/configTypes.js";
import type { FetchResult, NormalizedUpdate } from "../sourceTypes.js";
import { errorMessage } from "../../shared/errors.js";
import { classifySourceError } from "../sourceOutcome.js";
import type { CircuitBreakerDoc, UpdatesDeps } from "./updatesContracts.js";

export function createUpdatesCircuitBreaker(deps: UpdatesDeps, fetchGameUpdate: (game: GameConfig) => Promise<NormalizedUpdate>) {
  async function executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult> {
    const {
      circuitBreakerStore,
      CIRCUIT_BREAKER_FAIL_THRESHOLD,
      CIRCUIT_BREAKER_COOLDOWN_MS,
      CIRCUIT_BREAKER_JITTER_MS,
      SCHEMA_DRIFT_THRESHOLD,
      SchemaDriftError,
      adminAlert,
      getHttpMetrics
    } = deps;
    let cb: CircuitBreakerDoc;
    try {
      cb = await circuitBreakerStore.getOrCreate(game.key);
    } catch (cbGetErr) {
      deps.logger("WARN", "CIRCUIT_BREAKER",
        `Eroare la citirea state-ului CB pentru ${game.key}, sar fetch-ul ciclului curent`,
        errorMessage(cbGetErr));
      getHttpMetrics().fetchFail++;
      return { game, latest: null, error: errorMessage(cbGetErr), outcome: "transient-error" };
    }
    if (cb.cooldownUntil && new Date() < new Date(cb.cooldownUntil)) {
      return { game, latest: null, error: "Circuit Breaker Activ", outcome: "rate-limited" };
    }
    try {
      const latest = await fetchGameUpdate(game);
      if ((cb.fails ?? 0) > 0 || cb.cooldownUntil || cb.alertSent || (cb.schemaDriftFails ?? 0) > 0 || cb.schemaDriftAlertSent) {
        await circuitBreakerStore.reset(game.key);
      }
      getHttpMetrics().fetchSuccess++;
      return { game, latest, error: null, outcome: "ok" };
    } catch (error) {
      try {
        if (error instanceof SchemaDriftError) {
          const updatedCb = await circuitBreakerStore.registerSchemaDrift(game.key);
          if (updatedCb && (updatedCb.schemaDriftFails ?? 0) >= SCHEMA_DRIFT_THRESHOLD
              && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
            const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
            await circuitBreakerStore.openCircuit(game.key, new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter));
            if (!updatedCb.schemaDriftAlertSent) {
              await circuitBreakerStore.markSchemaDriftAlertSent(game.key);
              await adminAlert(
                `drift:${game.key}`,
                `Schema drift suspectat: ${game.name}`,
                `Sursa pentru \`${game.key}\` returnează HTTP OK dar 0 rezultate valide după ${updatedCb.schemaDriftFails} cicluri consecutive. Probabil selectorii CSS/HTML s-au schimbat.\nSursă: ${error.source}\nMesaj: ${error.message}\nCooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.`
              );
            }
          }
          getHttpMetrics().fetchFail++;
          return { game, latest: null, error: error.message, outcome: "schema-drift" };
        }

        const updatedCb = await circuitBreakerStore.registerFailure(game.key);
        if (updatedCb && (updatedCb.fails ?? 0) >= CIRCUIT_BREAKER_FAIL_THRESHOLD
            && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
          const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
          await circuitBreakerStore.openCircuit(game.key, new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter));
          if (!updatedCb.alertSent) {
            await circuitBreakerStore.markAlertSent(game.key);
            await adminAlert(
              `cb:${game.key}`,
              `Circuit breaker activat: ${game.name}`,
              `Sursa pentru \`${game.key}\` a eșuat de ${updatedCb.fails} ori consecutiv. Cooldown ~${Math.round(CIRCUIT_BREAKER_COOLDOWN_MS/60000)}-${Math.round((CIRCUIT_BREAKER_COOLDOWN_MS+CIRCUIT_BREAKER_JITTER_MS)/60000)} min.\nUltima eroare: ${errorMessage(error)}`
            );
          }
        }
      } catch (bookkeepingErr) {
        deps.logger("WARN", "CIRCUIT_BREAKER",
          `Eroare la actualizarea state-ului circuit breaker pentru ${game.key}`,
          errorMessage(bookkeepingErr));
      }
      getHttpMetrics().fetchFail++;
      return { game, latest: null, error: errorMessage(error), outcome: classifySourceError(errorMessage(error)) };
    }
  }

  return { executeFetchWithCircuitBreaker };
}
