import mongoContext from "../mongo/mongoContext.js";
import { createRedisRuntime } from "./redisClient.js";

const redisRuntime = createRedisRuntime(mongoContext.env, mongoContext.logger);

export default redisRuntime;
