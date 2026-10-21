import { hmacHex, safeEqual } from "./crypto";

/**
 * Stripe webhook signature (Stripe-Signature: t=...,v1=...).
 * signed_payload = `${t}.${rawBody}`, HMAC-SHA256 with the endpoint secret.
 */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const items = header.split(",").map((p) => p.trim().split("="));
  const t = items.find(([k]) => k === "t")?.[1];
  const v1s = items.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || v1s.length === 0) return false;
  const ts = parseInt(t, 10);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = hmacHex("sha256", secret, `${t}.${rawBody}`);
  return v1s.some((v) => safeEqual(v, expected));
}

export function signStripePayload(rawBody: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSec},v1=${hmacHex("sha256", secret, `${nowSec}.${rawBody}`)}`;
}

/** Recursively sort object keys (NOWPayments IPN signs JSON with sorted keys). */
export function sortObject(value: any): any {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = sortObject(value[k]);
        return acc;
      }, {});
  }
  return value;
}

/** NOWPayments IPN: x-nowpayments-sig = HMAC-SHA512(JSON.stringify(sorted body), IPN secret). */
export function verifyNowPaymentsSignature(body: any, header: string | null | undefined, ipnSecret: string): boolean {
  if (!header || !ipnSecret) return false;
  const expected = hmacHex("sha512", ipnSecret, JSON.stringify(sortObject(body)));
  return safeEqual(header.toLowerCase(), expected);
}

export function signNowPayments(body: any, ipnSecret: string): string {
  return hmacHex("sha512", ipnSecret, JSON.stringify(sortObject(body)));
}
