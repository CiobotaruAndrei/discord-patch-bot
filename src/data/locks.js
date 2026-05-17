"use strict";

module.exports = (ctx) => {
  const { crypto, JobLockModel, logger } = ctx;

const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  const lockToken = crypto.randomUUID();
  try {
    const lock = await JobLockModel.findOneAndUpdate(
      { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
      { $set: { lockedUntil: expires, ownerToken: lockToken } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (lock && lock.ownerToken === lockToken) {
      activeLocks.set(jobName, lockToken);
      return lockToken;
    }
    return null;
  } catch (err) {
    if (err.code === 11000) return null;
    logger("WARN", "DB_LOCK", "Eroare la obținerea lock-ului", err.message);
    return null;
  }
}

async function renewDbLock(jobName, token, ttlMs = 120000) {
  if (!token) return false;
  const expires = new Date(Date.now() + ttlMs);
  try {
    const res = await JobLockModel.updateOne(
      { _id: `lock_${jobName}`, ownerToken: token },
      { $set: { lockedUntil: expires } }
    );
    return res.modifiedCount > 0;
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la reînnoire lock", err.message);
    return false;
  }
}

async function releaseDbLock(jobName, token) {
  if (!token) return;
  try {
    await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
    activeLocks.delete(jobName);
  } catch (err) {
    logger("WARN", "DB_LOCK", "Eroare la eliberare lock", err.message);
  }
}

  Object.assign(ctx, {
    activeLocks,
    acquireDbLock,
    renewDbLock,
    releaseDbLock
  });
};
