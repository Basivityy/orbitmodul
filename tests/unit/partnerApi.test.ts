import { test } from "node:test";
import assert from "node:assert/strict";
import { apiOrderStatus, generateApiKey, hashApiKey, keyFromHeaders, parseAmount, PartnerApiError, signWebhook, validExternalRef, verifyWebhook } from "../../src/core/partnerApi";

const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

test("partner api: keys are random, prefixed, hashed; header parsing", () => {
  const a = generateApiKey();
  const b = generateApiKey();
  assert.notEqual(a.key, b.key);
  assert.match(a.key, /^om_live_[0-9A-Za-z]{40}$/);
  assert.equal(a.hash, hashApiKey(a.key));
  assert.equal(a.prefix, a.key.slice(0, 14));
  assert.equal(keyFromHeaders(headers({ authorization: `Bearer ${a.key}` })), a.key);
  assert.equal(keyFromHeaders(headers({ "x-api-key": a.key })), a.key);
  assert.equal(keyFromHeaders(headers({ authorization: "Bearer nope" })), null);
  assert.equal(keyFromHeaders(headers({})), null);
});

test("partner api: webhook signature verifies, rejects tampering and old timestamps", () => {
  const body = JSON.stringify({ event: "line.created", data: { username: "marko2026" } });
  const sig = signWebhook("whsec_x", body, 1_800_000_000);
  assert.equal(verifyWebhook("whsec_x", body, sig, 300, 1_800_000_100), true);
  assert.equal(verifyWebhook("whsec_x", body + " ", sig, 300, 1_800_000_100), false);
  assert.equal(verifyWebhook("other", body, sig, 300, 1_800_000_100), false);
  assert.equal(verifyWebhook("whsec_x", body, sig, 300, 1_800_001_000), false, "too old");
});

test("partner api: input helpers", () => {
  assert.equal(validExternalRef("woo-1234"), "woo-1234");
  assert.equal(validExternalRef(undefined), null);
  assert.throws(() => validExternalRef("bad ref with spaces"), PartnerApiError);
  assert.equal(parseAmount({ amount: "9.99" }), 999);
  assert.equal(parseAmount({ amount: "10,5" }), 1050);
  assert.equal(parseAmount({ amount_minor: 1500 }), 1500);
  assert.equal(parseAmount({}), null);
  assert.throws(() => parseAmount({ amount: "-1" }), PartnerApiError);
  assert.equal(apiOrderStatus("COMPLETED"), "completed");
  assert.equal(apiOrderStatus("ACTIVATING"), "activating");
  assert.equal(apiOrderStatus("ACTIVATION_FAILED"), "failed");
});
