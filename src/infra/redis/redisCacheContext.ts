import { createRedisCache } from "./redisCache";
import runtime from "./redisContext";
import _____mongo_mongoContext from "../mongo/mongoContext";
const { logger } = _____mongo_mongoContext;

const redisCache = createRedisCache({ runtime, logger });

export default redisCache;
