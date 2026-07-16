import redisRuntime from "./redisContext.js";
import { createRedisCache } from "./redisCache.js";
import mongoContext from "../mongo/mongoContext.js";

const redisCache = createRedisCache({ runtime: redisRuntime, logger: mongoContext.logger });

export default redisCache;
