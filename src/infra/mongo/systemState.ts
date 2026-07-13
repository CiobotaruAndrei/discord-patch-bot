import type { SystemTimes } from "../../types.js";
import type { MongoFilter, MongoUpdate, MongoQueryOptions } from "./mongoQueryShapes.js";

interface SystemStateDoc {
  _id: string;
  executionTimes?: SystemTimes;
  outboxPaused?: boolean;
}

interface SystemStateModelLike {
  findOneAndUpdate(filter: MongoFilter, update: MongoUpdate, options?: MongoQueryOptions): { lean(): Promise<SystemStateDoc | null> };
  findByIdAndUpdate(id: string, update: MongoUpdate, options?: MongoQueryOptions): Promise<unknown>;
  findById(id: string): { lean(): Promise<SystemStateDoc | null> };
}

type SystemTimesKey = keyof SystemTimes;

type GetSystemTimes = () => Promise<SystemTimes>;
type SaveSystemTimes = (times: SystemTimes) => Promise<void>;
type SaveSystemTime = (key: SystemTimesKey, value: number) => Promise<void>;
type GetOutboxPaused = () => Promise<boolean>;
type SetOutboxPaused = (paused: boolean) => Promise<void>;

interface SystemStateContext {
  SystemModel: SystemStateModelLike;
  getSystemTimes?: GetSystemTimes;
  saveSystemTimes?: SaveSystemTimes;
  saveSystemTime?: SaveSystemTime;
  getOutboxPaused?: GetOutboxPaused;
  setOutboxPaused?: SetOutboxPaused;
}

const DEFAULT_SYSTEM_TIMES: SystemTimes = { all: 35000, single: 2000, reduceri: 10000 };
const SYSTEM_TIMES_KEYS: SystemTimesKey[] = ["all", "single", "reduceri"];

function defaultSystemTimes(): SystemTimes {
  return { ...DEFAULT_SYSTEM_TIMES };
}

function buildSystemStateFrom(context: SystemStateContext) {
  const SystemModel = context.SystemModel;

  const getSystemTimes: GetSystemTimes = async () => {
    const sys = await SystemModel.findOneAndUpdate(
      { _id: "system_state" },
      { $setOnInsert: { executionTimes: defaultSystemTimes() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return sys?.executionTimes || defaultSystemTimes();
  };

  const saveSystemTimes: SaveSystemTimes = async (times) => {
    await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
  };

  const saveSystemTime: SaveSystemTime = async (key, value) => {
    if (!SYSTEM_TIMES_KEYS.includes(key)) return;
    if (!Number.isFinite(value) || value <= 0) return;
    await SystemModel.findByIdAndUpdate(
      "system_state",
      { $set: { [`executionTimes.${key}`]: value } },
      { upsert: true }
    );
  };

  const getOutboxPaused: GetOutboxPaused = async () => {
    try {
      const sys = await SystemModel.findById("system_state").lean();
      return sys?.outboxPaused === true;
    } catch {
      return false;
    }
  };

  const setOutboxPaused: SetOutboxPaused = async (paused) => {
    await SystemModel.findByIdAndUpdate(
      "system_state",
      { $set: { outboxPaused: paused === true } },
      { upsert: true }
    );
  };

  return {
    getSystemTimes,
    saveSystemTimes,
    saveSystemTime,
    getOutboxPaused,
    setOutboxPaused
  };
}

function attachSystemState(target: SystemStateContext): void {
  Object.assign(target, buildSystemStateFrom(target));
}

attachSystemState.buildFrom = buildSystemStateFrom;

export default attachSystemState;
