import { hmacHex, safeEqual } from "./crypto";

/**
 * Short-lived signed link "renew this line" given out after a customer entered their username
 * on the store. Keeps subscription ids from being enumerable/forgeable in checkout URLs.
 */
const TTL_MS = 2 * 3600_000;

function secret(rawKey?: string): string {
  const k = rawKey ?? process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY is not set");
  return `renew-line:${k}`;
}

export function makeRenewToken(subscriptionId: string, now = Date.now(), rawKey?: string): string {
  const exp = String(now + TTL_MS);
  return `${exp}.${hmacHex("sha256", secret(rawKey), `${subscriptionId}.${exp}`).slice(0, 40)}`;
}

export function verifyRenewToken(subscriptionId: string, token: string | null | undefined, now = Date.now(), rawKey?: string): boolean {
  if (!token || !subscriptionId) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, hmacHex("sha256", secret(rawKey), `${subscriptionId}.${exp}`).slice(0, 40));
}
