import type { FetchResult, GameConfig, NormalizedUpdate } from "../../types.js";
import { errorMessage } from "../../shared/errors.js";
import { classifySourceError } from "../sourceOutcome.js";
import type { CircuitBreakerDoc, UpdatesDeps } from "./updatesContracts.js";

export function createUpdatesCircuitBreaker(deps: UpdatesDeps, fetchGameUpdate: (game: GameConfig) => Promise<NormalizedUpdate>) {
  async function executeFetchWithCircuitBreaker(game: GameConfig): Promise<FetchResult> {
    const {
      CircuitBreakerModel,
      CIRCUIT_BREAKER_FAIL_THRESHOLD,
      CIRCUIT_BREAKER_COOLDOWN_MS,
      CIRCUIT_BREAKER_JITTER_MS,
      SCHEMA_DRIFT_THRESHOLD,
      SchemaDriftError,
      adminAlert,
      getHttpMetrics
    } = deps;
    let cb: CircuitBreakerDoc | null = null;
    try {
      cb = await CircuitBreakerModel.findOneAndUpdate(
        { _id: game.key },
        { $setOnInsert: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (!cb) throw new Error(`Circuit breaker document lipsa pentru ${game.key}`);
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
        await CircuitBreakerModel.updateOne(
          { _id: game.key },
          { $set: { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false } }
        );
      }
      getHttpMetrics().fetchSuccess++;
      return { game, latest, error: null, outcome: "ok" };
    } catch (error) {
      try {
        if (error instanceof SchemaDriftError) {
          const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
            { _id: game.key },
            { $inc: { schemaDriftFails: 1 } },
            { new: true, upsert: true }
          );
          if (updatedCb && (updatedCb.schemaDriftFails ?? 0) >= SCHEMA_DRIFT_THRESHOLD
              && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
            const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
            await CircuitBreakerModel.updateOne(
              { _id: game.key },
              { $set: { cooldownUntil: new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter) } }
            );
            if (!updatedCb.schemaDriftAlertSent) {
              await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { schemaDriftAlertSent: true } });
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

        const updatedCb = await CircuitBreakerModel.findOneAndUpdate(
          { _id: game.key },
          { $inc: { fails: 1 } },
          { new: true, upsert: true }
        );
        if (updatedCb && (updatedCb.fails ?? 0) >= CIRCUIT_BREAKER_FAIL_THRESHOLD
            && (!updatedCb.cooldownUntil || new Date() >= new Date(updatedCb.cooldownUntil))) {
          const jitter = Math.floor(Math.random() * CIRCUIT_BREAKER_JITTER_MS);
          await CircuitBreakerModel.updateOne(
            { _id: game.key },
            { $set: { cooldownUntil: new Date(Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS + jitter) } }
          );
          if (!updatedCb.alertSent) {
            await CircuitBreakerModel.updateOne({ _id: game.key }, { $set: { alertSent: true } });
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
