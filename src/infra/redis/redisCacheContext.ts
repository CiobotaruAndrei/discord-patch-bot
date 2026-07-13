import { createRedisCache } from "./redisCache.js";
import runtime from "./redisContext.js";
import _____mongo_mongoContext from "../mongo/mongoContext.js";
const { logger } = _____mongo_mongoContext;

const redisCache = createRedisCache({ runtime, logger });

export default redisCache;
