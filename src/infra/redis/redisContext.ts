import { createRedisRuntime } from "./redisClient";
import _____mongo_mongoContext from "../mongo/mongoContext";
const { env, logger } = _____mongo_mongoContext;

const redisRuntime = createRedisRuntime(env, logger);

export default redisRuntime;
