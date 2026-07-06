const { createRedisRuntime } = require("./redisClient") as typeof import("./redisClient");
const { env, logger } = require("../mongo/mongoContext") as typeof import("../mongo/mongoContext");

const redisRuntime = createRedisRuntime(env, logger);

export = redisRuntime;
