import type { Model } from "mongoose";
import type { SystemTimes } from "../../types";

interface SystemStateDoc {
  _id: string;
  executionTimes?: SystemTimes;
}

interface SystemStateContext {
  SystemModel: Model<SystemStateDoc>;
  getSystemTimes?: typeof getSystemTimes;
  saveSystemTimes?: typeof saveSystemTimes;
}

const DEFAULT_SYSTEM_TIMES: SystemTimes = { all: 35000, single: 2000, reduceri: 10000 };
let runtimeContext: Pick<SystemStateContext, "SystemModel">;

function defaultSystemTimes(): SystemTimes {
  return { ...DEFAULT_SYSTEM_TIMES };
}

async function getSystemTimes(): Promise<SystemTimes> {
  const sys = await runtimeContext.SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: defaultSystemTimes() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean() as SystemStateDoc | null;
  return sys?.executionTimes || defaultSystemTimes();
}

async function saveSystemTimes(times: SystemTimes): Promise<void> {
  await runtimeContext.SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

function attachSystemState(ctx: SystemStateContext): void {
  runtimeContext = {
    SystemModel: ctx.SystemModel
  };

  Object.assign(ctx, {
    getSystemTimes,
    saveSystemTimes
  });
}

export = attachSystemState;
