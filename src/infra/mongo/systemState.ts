import type { SystemTimes } from "../../types";

interface SystemStateDoc {
  _id: string;
  executionTimes?: SystemTimes;
  outboxPaused?: boolean;
}

interface SystemStateModelLike {
  findOneAndUpdate(filter: unknown, update: unknown, options?: unknown): { lean(): Promise<SystemStateDoc | null> };
  findByIdAndUpdate(id: string, update: unknown, options?: unknown): Promise<unknown>;
  findById(id: string): { lean(): Promise<SystemStateDoc | null> };
}

type SystemTimesKey = keyof SystemTimes;

interface SystemStateContext {
  SystemModel: SystemStateModelLike;
  getSystemTimes?: typeof getSystemTimes;
  saveSystemTimes?: typeof saveSystemTimes;
  saveSystemTime?: typeof saveSystemTime;
  getOutboxPaused?: typeof getOutboxPaused;
  setOutboxPaused?: typeof setOutboxPaused;
}

const DEFAULT_SYSTEM_TIMES: SystemTimes = { all: 35000, single: 2000, reduceri: 10000 };
const SYSTEM_TIMES_KEYS: SystemTimesKey[] = ["all", "single", "reduceri"];
let runtimeContext: Pick<SystemStateContext, "SystemModel">;

function defaultSystemTimes(): SystemTimes {
  return { ...DEFAULT_SYSTEM_TIMES };
}

async function getSystemTimes(): Promise<SystemTimes> {
  const sys = await runtimeContext.SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: defaultSystemTimes() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return sys?.executionTimes || defaultSystemTimes();
}

async function saveSystemTimes(times: SystemTimes): Promise<void> {
  await runtimeContext.SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

async function saveSystemTime(key: SystemTimesKey, value: number): Promise<void> {
  if (!SYSTEM_TIMES_KEYS.includes(key)) return;
  if (!Number.isFinite(value) || value <= 0) return;
  await runtimeContext.SystemModel.findByIdAndUpdate(
    "system_state",
    { $set: { [`executionTimes.${key}`]: value } },
    { upsert: true }
  );
}

async function getOutboxPaused(): Promise<boolean> {
  try {
    const sys = await runtimeContext.SystemModel.findById("system_state").lean();
    return sys?.outboxPaused === true;
  } catch {
    return false;
  }
}

async function setOutboxPaused(paused: boolean): Promise<void> {
  await runtimeContext.SystemModel.findByIdAndUpdate(
    "system_state",
    { $set: { outboxPaused: paused === true } },
    { upsert: true }
  );
}

function buildSystemStateFrom(context: SystemStateContext) {
  runtimeContext = {
    SystemModel: context.SystemModel
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

export = attachSystemState;
