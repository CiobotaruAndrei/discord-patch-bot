import { createRedisRuntime } from "./redisClient.js";
import _____mongo_mongoContext from "../mongo/mongoContext.js";
const { env, logger } = _____mongo_mongoContext;

const redisRuntime = createRedisRuntime(env, logger);

export default redisRuntime;
