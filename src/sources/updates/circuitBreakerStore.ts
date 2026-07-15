import type { CircuitBreakerDoc, CircuitBreakerModelLike } from "./updatesContracts.js";

export interface CircuitBreakerStore {
  getOrCreate(key: string): Promise<CircuitBreakerDoc>;
  reset(key: string): Promise<void>;
  registerFailure(key: string): Promise<CircuitBreakerDoc | null>;
  registerSchemaDrift(key: string): Promise<CircuitBreakerDoc | null>;
  openCircuit(key: string, until: Date): Promise<void>;
  markAlertSent(key: string): Promise<void>;
  markSchemaDriftAlertSent(key: string): Promise<void>;
}

const DEFAULT_STATE = { fails: 0, cooldownUntil: null, alertSent: false, schemaDriftFails: 0, schemaDriftAlertSent: false };

export function createCircuitBreakerStore(model: CircuitBreakerModelLike): CircuitBreakerStore {
  return {
    async getOrCreate(key: string): Promise<CircuitBreakerDoc> {
      const doc = await model.findOneAndUpdate(
        { _id: key },
        { $setOnInsert: DEFAULT_STATE },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
      );
      if (!doc) throw new Error(`Circuit breaker document lipsa pentru ${key}`);
      return doc;
    },
    async reset(key: string): Promise<void> {
      await model.updateOne({ _id: key }, { $set: DEFAULT_STATE });
    },
    registerFailure(key: string): Promise<CircuitBreakerDoc | null> {
      return model.findOneAndUpdate({ _id: key }, { $inc: { fails: 1 } }, { returnDocument: "after", upsert: true });
    },
    registerSchemaDrift(key: string): Promise<CircuitBreakerDoc | null> {
      return model.findOneAndUpdate({ _id: key }, { $inc: { schemaDriftFails: 1 } }, { returnDocument: "after", upsert: true });
    },
    async openCircuit(key: string, until: Date): Promise<void> {
      await model.updateOne({ _id: key }, { $set: { cooldownUntil: until } });
    },
    async markAlertSent(key: string): Promise<void> {
      await model.updateOne({ _id: key }, { $set: { alertSent: true } });
    },
    async markSchemaDriftAlertSent(key: string): Promise<void> {
      await model.updateOne({ _id: key }, { $set: { schemaDriftAlertSent: true } });
    }
  };
}
