import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";
import { decrypt, encrypt, encryptJson, decryptJson, maskSecret } from "../../src/core/crypto";
import { hashPassword, passwordPolicyError, verifyPassword } from "../../src/core/password";
import { base32Decode, base32Encode, generateTotpSecret, totpAt, verifyTotp } from "../../src/core/totp";
import { formatMoney, minorToDecimalString, parseAmountToMinor } from "../../src/core/money";
import { applyCoupon, effectivePrice } from "../../src/core/pricing";
import { addDays, computeRenewalExpiry, recurringInterval } from "../../src/core/dates";
import { renderTemplate } from "../../src/core/template";
import { generateLinePassword, generateLineUsername, isValidEmail, isValidSlug, normalizeDomain, slugify } from "../../src/core/ids";
import { signNowPayments, signStripePayload, verifyNowPaymentsSignature, verifyStripeSignature } from "../../src/core/signatures";
import { formEncode, redact } from "../../src/core/http";
import { assertPublicUrl, isPrivateIp } from "../../src/core/net";

const KEY = randomBytes(32).toString("base64");

test("AES-GCM encrypt/decrypt roundtrip and tamper detection", () => {
  const c = encrypt("panel-secret-value", KEY);
  assert.notEqual(c, "panel-secret-value");
  assert.equal(decrypt(c, KEY), "panel-secret-value");
  assert.notEqual(encrypt("x", KEY), encrypt("x", KEY), "random IV per encryption");
  const parts = c.split(":");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join(":"), KEY));
  assert.throws(() => decrypt(c, randomBytes(32).toString("base64")), "wrong key must fail");
  assert.deepEqual(decryptJson(encryptJson({ a: 1 }, KEY), KEY), { a: 1 });
  assert.equal(maskSecret("abcdEFGHijklMNOPqrstUVWX"), "••••••••UVWX");
});

test("scrypt password hashing", async () => {
  const h = await hashPassword("CorrectHorse9");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await verifyPassword("CorrectHorse9", h), true);
  assert.equal(await verifyPassword("wrong", h), false);
  assert.equal(passwordPolicyError("short1"), "Password must be at least 10 characters.");
  assert.equal(passwordPolicyError("onlyletterslong"), "Password must contain letters and numbers.");
  assert.equal(passwordPolicyError("goodpassword123"), null);
});

test("TOTP matches RFC 6238 test vector and verifies with drift", () => {
  // RFC 6238 SHA1 secret "12345678901234567890", T=59 -> 94287082 (8 digits) -> 6 digits 287082
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpAt(secret, 59_000), "287082");
  assert.equal(totpAt(secret, 1111111109_000), "081804");
  assert.deepEqual(base32Decode(secret), Buffer.from("12345678901234567890"));
  const s = generateTotpSecret();
  const now = Date.now();
  assert.equal(verifyTotp(s, totpAt(s, now), now), true);
  assert.equal(verifyTotp(s, totpAt(s, now - 30_000), now), true);
  assert.equal(verifyTotp(s, totpAt(s, now - 120_000), now), false);
  assert.equal(verifyTotp(s, "abc", now), false);
});

test("money parsing and formatting", () => {
  assert.equal(parseAmountToMinor("10", "EUR"), 1000);
  assert.equal(parseAmountToMinor("10.5", "EUR"), 1050);
  assert.equal(parseAmountToMinor("10,99", "BAM"), 1099);
  assert.equal(parseAmountToMinor("10.999", "EUR"), null);
  assert.equal(parseAmountToMinor("-1", "EUR"), null);
  assert.equal(parseAmountToMinor("1000", "JPY"), 1000);
  assert.equal(minorToDecimalString(1050, "EUR"), "10.50");
  assert.equal(minorToDecimalString(5, "USD"), "0.05");
  assert.ok(formatMoney(1050, "EUR").includes("10.50"));
  assert.ok(formatMoney(3500, "AED").includes("35.00"));
});

test("reseller pricing: promo and coupons", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const pkg = { id: "p1", priceCents: 2000, currency: "EUR", promoPriceCents: 1500, promoEndsAt: new Date("2026-10-20T00:00:00Z") };
  assert.deepEqual(effectivePrice(pkg, now), { amount: 1500, isPromo: true });
  assert.deepEqual(effectivePrice({ ...pkg, promoEndsAt: new Date("2026-10-01T00:00:00Z") }, now), { amount: 2000, isPromo: false });
  const base = { code: "X", type: "PERCENT" as const, value: 25, redemptions: 0, packageIds: [], active: true };
  assert.deepEqual(applyCoupon(2000, "EUR", "p1", base, now), { ok: true, discount: 500, total: 1500 });
  assert.deepEqual(applyCoupon(2000, "EUR", "p1", { ...base, type: "FIXED", value: 5000, currency: "EUR" }, now), { ok: true, discount: 2000, total: 0 });
  assert.equal(applyCoupon(2000, "EUR", "p1", { ...base, type: "FIXED", value: 100, currency: "USD" }, now).ok, false);
  assert.equal(applyCoupon(2000, "EUR", "p2", { ...base, packageIds: ["p1"] }, now).ok, false);
  assert.equal(applyCoupon(2000, "EUR", "p1", { ...base, maxRedemptions: 1, redemptions: 1 }, now).ok, false);
  assert.equal(applyCoupon(2000, "EUR", "p1", { ...base, validUntil: new Date("2026-10-10") }, now).ok, false);
});

test("renewal expiry never loses remaining days", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  assert.equal(computeRenewalExpiry(new Date("2026-10-21T00:00:00Z"), now, 30).toISOString(), "2026-11-20T00:00:00.000Z");
  assert.equal(computeRenewalExpiry(new Date("2026-10-01T00:00:00Z"), now, 30).toISOString(), "2026-11-10T00:00:00.000Z");
  assert.equal(computeRenewalExpiry(null, now, 1).toISOString(), addDays(now, 1).toISOString());
  assert.deepEqual(recurringInterval(30), { interval: "month", count: 1 });
  assert.deepEqual(recurringInterval(90), { interval: "month", count: 3 });
  assert.deepEqual(recurringInterval(365), { interval: "year", count: 1 });
  assert.deepEqual(recurringInterval(14), { interval: "week", count: 2 });
  assert.deepEqual(recurringInterval(10), { interval: "day", count: 10 });
});

test("templates escape HTML", () => {
  assert.equal(renderTemplate("Hi {{name}}!", { name: "<b>x</b>" }, { html: true }), "Hi &lt;b&gt;x&lt;/b&gt;!");
  assert.equal(renderTemplate("Hi {{ name }} {{missing}}", { name: "Ana" }), "Hi Ana ");
});

test("ids, slugs, emails, domains", () => {
  const u = generateLineUsername("my-shop");
  assert.match(u, /^myshop[a-z]{2}[a-z2-9]{8}$/);
  assert.equal(generateLinePassword().length, 10);
  assert.equal(slugify("Ćevapi TV Shop!"), "cevapi-tv-shop");
  assert.equal(isValidSlug("my-store"), true);
  assert.equal(isValidSlug("admin"), false);
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("nope"), false);
  assert.equal(normalizeDomain("https://Shop.Example.com/path"), "shop.example.com");
  assert.equal(normalizeDomain("localhost"), null);
});

test("Stripe signature verification", () => {
  const body = JSON.stringify({ id: "evt_1" });
  const now = Math.floor(Date.now() / 1000);
  const header = signStripePayload(body, "whsec_test", now);
  assert.equal(verifyStripeSignature(body, header, "whsec_test", 300, now), true);
  assert.equal(verifyStripeSignature(body + " ", header, "whsec_test", 300, now), false, "modified body");
  assert.equal(verifyStripeSignature(body, header, "whsec_other", 300, now), false, "wrong secret");
  assert.equal(verifyStripeSignature(body, header, "whsec_test", 300, now + 1000), false, "replay outside tolerance");
  assert.equal(verifyStripeSignature(body, undefined, "whsec_test"), false);
});

test("NOWPayments IPN signature (sorted keys, HMAC-SHA512)", () => {
  const body = { payment_status: "finished", order_id: "o1", payment_id: 123, nested: { b: 1, a: 2 } };
  const sig = signNowPayments(body, "ipn");
  assert.equal(verifyNowPaymentsSignature({ order_id: "o1", nested: { a: 2, b: 1 }, payment_id: 123, payment_status: "finished" }, sig, "ipn"), true);
  assert.equal(verifyNowPaymentsSignature({ ...body, payment_status: "failed" }, sig, "ipn"), false);
});

test("form encoding arrays and secret redaction", () => {
  assert.equal(formEncode({ a: 1, "b[]": ["1", "2"], c: undefined }), "a=1&b%5B%5D=1&b%5B%5D=2");
  assert.equal(redact("url?api_key=ABC123&x=1 token tok12345", ["tok12345"]), "url?api_key=***&x=1 token ***");
});

test("SSRF guard blocks private and internal addresses", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2a00:1450::1"]) assert.equal(isPrivateIp(ip), false, ip);
  await assert.rejects(assertPublicUrl("http://127.0.0.1:6379/", false), /private or internal/);
  await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data", false), /private or internal/);
  await assert.rejects(assertPublicUrl("http://localhost:5432/", false));
  await assertPublicUrl("http://127.0.0.1/", true);
});

import { spawnSync } from "child_process";
import { join } from "path";

test("prisma schema: every relation has its opposite side (prisma validate P1012)", () => {
  const root = join(__dirname, "../../..");
  const r = spawnSync("python3", [join(root, "scripts/check_schema_relations.py"), join(root, "prisma/schema.prisma")], { encoding: "utf8" });
  if (r.error) return; // python3 not available
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("net: a public host is checked once and then cached; private stays blocked", async () => {
  await assertPublicUrl("http://1.1.1.1/a", false);
  await assertPublicUrl("http://1.1.1.1/b", false); // cached
  await assert.rejects(assertPublicUrl("http://127.0.0.1/x", false), /private or internal/);
  await assert.rejects(assertPublicUrl("http://10.0.0.5/x", false), /private or internal/);
});
