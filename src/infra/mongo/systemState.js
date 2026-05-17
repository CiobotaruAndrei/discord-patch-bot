"use strict";

module.exports = (ctx) => {
  const { SystemModel } = ctx;

async function getSystemTimes() {
  const sys = await SystemModel.findOneAndUpdate(
    { _id: "system_state" },
    { $setOnInsert: { executionTimes: { all: 35000, single: 2000, reduceri: 10000 } } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return sys.executionTimes || { all: 35000, single: 2000, reduceri: 10000 };
}

async function saveSystemTimes(times) {
  await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

  Object.assign(ctx, {
    getSystemTimes,
    saveSystemTimes
  });
};
