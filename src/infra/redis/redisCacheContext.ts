const { createRedisCache } = require("./redisCache") as typeof import("./redisCache");
const runtime = require("./redisContext") as typeof import("./redisContext");
const { logger } = require("../mongo/mongoContext") as typeof import("../mongo/mongoContext");

const redisCache = createRedisCache({ runtime, logger });

export = redisCache;
