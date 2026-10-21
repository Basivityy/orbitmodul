import { headers } from "next/headers";
import { redis } from "./redis";

/** Fixed-window limiter in Redis. Fails open (logs) if Redis is unreachable. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = await redis().incr(k);
    if (n === 1) await redis().expire(k, windowSec + 5);
    return n <= limit;
  } catch (e) {
    console.error("[ratelimit] redis unavailable", (e as Error).message);
    return true;
  }
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function userAgent(): Promise<string> {
  return ((await headers()).get("user-agent") ?? "").slice(0, 300);
}
