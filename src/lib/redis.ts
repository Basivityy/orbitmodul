import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

const g = globalThis as unknown as { redis?: Redis };

/** Shared connection. maxRetriesPerRequest=null is required by BullMQ. */
export function redis(): Redis {
  if (!g.redis) {
    g.redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
    g.redis.on("error", (e) => console.error("[redis]", e.message));
  }
  return g.redis;
}
