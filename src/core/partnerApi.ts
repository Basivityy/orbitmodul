/**
 * Website API for resellers (server-to-server): key format, hashing, webhook signatures and
 * small input helpers. Pure logic, no database.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const KEY_PREFIX = "om_live_";
/** A new key is shown once: kept 2 minutes in an encrypted, http-only cookie (never in the URL). */
export const NEW_KEY_COOKIE = "om_new_api_key";
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export class PartnerApiError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string, message: string) {
    super(message);
  }
}

/** New secret key: "om_live_" + 40 random base62 characters. Shown to the reseller once. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const bytes = randomBytes(40);
  let body = "";
  for (const b of bytes) body += B62[b % 62];
  const key = KEY_PREFIX + body;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 6), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

/** "Authorization: Bearer om_live_…" (or X-Api-Key) → key, or null. */
export function keyFromHeaders(h: { get(name: string): string | null }): string | null {
  const auth = h.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  const key = (m?.[1] ?? h.get("x-api-key") ?? "").trim();
  return key.startsWith(KEY_PREFIX) && key.length >= KEY_PREFIX.length + 20 && key.length <= 120 ? key : null;
}

/** Webhook signature header: "t=<unix>,v1=<hex hmac-sha256 of `${t}.${body}`>" (like Stripe). */
export function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** For the documentation and tests: how the reseller's site checks a webhook. */
export function verifyWebhook(secret: string, body: string, header: string, toleranceSec = 300, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSec || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(parts.v1, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function newWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("hex");
}

/** Your own order reference (idempotency): letters, digits and - _ . : / # up to 100 chars. */
export function validExternalRef(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!/^[A-Za-z0-9_.:/#-]{1,100}$/.test(s)) throw new PartnerApiError(400, "invalid_external_ref", "external_ref: 1–100 letters, digits or - _ . : / #");
  return s;
}

/** Amount in the package currency as a decimal ("9.99") or minor units ("amount_minor": 999). */
export function parseAmount(body: Record<string, unknown>): number | null {
  if (body.amount_minor !== undefined && body.amount_minor !== null) {
    const n = Number(body.amount_minor);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new PartnerApiError(400, "invalid_amount", "amount_minor must be a whole number ≥ 0 (cents).");
    return n;
  }
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const n = Number(String(body.amount).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new PartnerApiError(400, "invalid_amount", "amount must be a number ≥ 0, e.g. 9.99.");
    return Math.round(n * 100);
  }
  return null;
}

export type ApiOrderStatus = "pending" | "activating" | "completed" | "failed" | "canceled";

export function apiOrderStatus(s: string): ApiOrderStatus {
  if (s === "COMPLETED") return "completed";
  if (s === "ACTIVATION_FAILED" || s === "FAILED" || s === "REFUNDED") return "failed";
  if (s === "CANCELED") return "canceled";
  if (s === "PENDING") return "pending";
  return "activating"; // PAID, ACTIVATING, ON_HOLD
}

/** Events sent to the reseller's webhook. */
export const WEBHOOK_EVENTS = ["line.created", "line.extended", "activation.failed", "line.expiring", "ping"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
