const mongoose = require("mongoose");
const crypto = require("crypto");

const guildSchema = new mongoose.Schema({
    _id: String,
    language: { type: String, enum: ["ro", "en"], default: "ro" },
    subscribed: { type: Boolean, default: false },
    notificationChannelId: { type: String, default: null },
    seen: { type: Map, of: [String], default: {} },
    discountsSubscribed: { type: Boolean, default: false },
    discountChannelId: { type: String, default: null },
    seenDiscounts: { type: [String], default: [] },
    freeSubscribed: { type: Boolean, default: false },
    freeChannelId: { type: String, default: null },
    seenFree: { type: [String], default: [] },
    minDiscountPercent: { type: Number, default: 70 },
    notificationMode: { type: String, enum: ["compact", "detailed"], default: "detailed" }
}, { minimize: false });
const GuildModel = mongoose.model("Guild", guildSchema);

const circuitBreakerSchema = new mongoose.Schema({
    _id: String,
    fails: { type: Number, default: 0 },
    cooldownUntil: { type: Date, default: null }
}, { minimize: false });
const CircuitBreakerModel = mongoose.model("CircuitBreaker", circuitBreakerSchema);

const systemSchema = new mongoose.Schema({
    _id: { type: String, default: "system_state" },
    executionTimes: { all: { type: Number, default: 35000 }, single: { type: Number, default: 2000 }, deals: { type: Number, default: 10000 }, free: { type: Number, default: 10000 } }
}, { minimize: false });
const SystemModel = mongoose.model("System", systemSchema);

const jobLockSchema = new mongoose.Schema({
    _id: String,
    lockedUntil: { type: Date, default: null, index: true },
    ownerToken: { type: String, default: null }
}, { minimize: false });
const JobLockModel = mongoose.model("JobLock", jobLockSchema);

const activeLocks = new Map();

async function acquireDbLock(jobName, ttlMs = 120000) {
    const now = new Date();
    const expires = new Date(now.getTime() + ttlMs);
    const lockToken = crypto.randomUUID();

    try {
        const lock = await JobLockModel.findOneAndUpdate(
            { _id: `lock_${jobName}`, $or: [{ lockedUntil: { $lt: now } }, { lockedUntil: null }] },
            { $set: { lockedUntil: expires, ownerToken: lockToken } },
            { new: true }
        );
        if (lock && lock.ownerToken === lockToken) {
            activeLocks.set(jobName, lockToken);
            return lockToken;
        }
        try {
            await JobLockModel.create({
                _id: `lock_${jobName}`,
                lockedUntil: expires,
                ownerToken: lockToken
            });
            activeLocks.set(jobName, lockToken);
            return lockToken;
        } catch (createErr) {
            if (createErr.code === 11000) return null;
            throw createErr;
        }
    } catch (err) {
        console.warn(`[DB_LOCK] Eroare la obținerea lock-ului: ${err.message}`);
        return null;
    }
}

async function renewDbLock(jobName, token, ttlMs = 120000) {
    if (!token) return false;
    const expires = new Date(Date.now() + ttlMs);
    try {
        const res = await JobLockModel.updateOne({ _id: `lock_${jobName}`, ownerToken: token }, { $set: { lockedUntil: expires } });
        return res.modifiedCount > 0;
    } catch (err) { return false; }
}

async function releaseDbLock(jobName, token) {
    if (!token) return;
    try {
        await JobLockModel.deleteOne({ _id: `lock_${jobName}`, ownerToken: token });
        activeLocks.delete(jobName);
    } catch (err) {}
}

async function getSystemTimes() {
    let sys = await SystemModel.findOneAndUpdate(
        { _id: "system_state" },
        { $setOnInsert: { executionTimes: { all: 35000, single: 2000, deals: 10000, free: 10000 } } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return sys.executionTimes || { all: 35000, single: 2000, deals: 10000, free: 10000 };
}

async function saveSystemTimes(times) {
    await SystemModel.findByIdAndUpdate("system_state", { $set: { executionTimes: times } }, { upsert: true });
}

module.exports = {
    GuildModel,
    CircuitBreakerModel,
    SystemModel,
    JobLockModel,
    activeLocks,
    acquireDbLock,
    renewDbLock,
    releaseDbLock,
    getSystemTimes,
    saveSystemTimes
};
