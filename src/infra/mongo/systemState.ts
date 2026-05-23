import type { Model } from "mongoose";
import type { SystemTimes } from "../../types";

interface SystemStateDoc {
  _id: string;
  executionTimes?: SystemTimes;
}

type SystemTimesKey = keyof SystemTimes;

interface SystemStateContext {
  SystemModel: Model<SystemStateDoc>;
  getSystemTimes?: typeof getSystemTimes;
  saveSystemTimes?: typeof saveSystemTimes;
  saveSystemTime?: typeof saveSystemTime;
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
  ).lean() as SystemStateDoc | null;
  return sys?.executionTimes || defaultSystemTimes();
}

async function saveSystemTimes(times: SystemTimes): Promise<void> {
  await runtimeContext.SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

// V11: per-key save fara lost-write race. saveSystemTimes(times) scria tot
// obiectul `executionTimes`, deci doua comenzi concurrente (ex. `/latest pret`
// si `/latest updates`) puteau face fiecare `read → modify-one-field → write
// all`, ultima victorie suprascriind update-ul celeilalte. saveSystemTime
// scrie un singur camp prin dot-path (`executionTimes.single`), deci ambele
// updates pot ajunge la nivelul corect chiar daca se executa in paralel.
async function saveSystemTime(key: SystemTimesKey, value: number): Promise<void> {
  if (!SYSTEM_TIMES_KEYS.includes(key)) return;
  if (!Number.isFinite(value) || value <= 0) return;
  await runtimeContext.SystemModel.findByIdAndUpdate(
    "system_state",
    { $set: { [`executionTimes.${key}`]: value } },
    { upsert: true }
  );
}

function attachSystemState(ctx: SystemStateContext): void {
  runtimeContext = {
    SystemModel: ctx.SystemModel
  };

  Object.assign(ctx, {
    getSystemTimes,
    saveSystemTimes,
    saveSystemTime
  });
}

export = attachSystemState;
