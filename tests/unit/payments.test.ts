import { test } from "node:test";
import assert from "node:assert/strict";
import { getProvider, WebhookVerificationError } from "../../src/core/payments";
import { signNowPayments, signStripePayload } from "../../src/core/signatures";
import { startServer } from "../mocks/servers";

const input = {
  orderId: "ord_1",
  orderNumber: "ORD-1",
  amountMinor: 1050,
  currency: "EUR",
  description: "Basic 30 days",
  customerEmail: "c@x.com",
  successUrl: "https://app.test/store/s/order/tok",
  cancelUrl: "https://app.test/store/s",
  webhookUrl: "https://app.test/api/webhooks/STRIPE/wh",
};

test("Stripe: checkout session request + webhook events", async () => {
  const s = await startServer(({ path }) => (path === "/v1/checkout/sessions" ? { json: { id: "cs_1", url: "https://checkout.stripe.com/cs_1" } } : { status: 404, json: {} }));
  try {
    const p = getProvider("STRIPE");
    const creds = { secretKey: "sk_test_x", webhookSecret: "whsec_1", apiBase: s.url };
    const r = await p.createCheckout(creds, input, { sandbox: true });
    assert.deepEqual(r, { redirectUrl: "https://checkout.stripe.com/cs_1", providerRef: "cs_1" });
    const form = new URLSearchParams(s.calls[0].body);
    assert.equal(form.get("mode"), "payment");
    assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1050");
    assert.equal(form.get("line_items[0][price_data][currency]"), "eur");
    assert.equal(form.get("metadata[orderId]"), "ord_1");
    assert.equal(s.calls[0].headers["authorization"], "Bearer sk_test_x");
    assert.equal(s.calls[0].headers["idempotency-key"], "checkout-ord_1");

    await p.createCheckout(creds, { ...input, recurring: { durationDays: 30 } }, { sandbox: true });
    const f2 = new URLSearchParams(s.calls[1].body);
    assert.equal(f2.get("mode"), "subscription");
    assert.equal(f2.get("line_items[0][price_data][recurring][interval]"), "month");

    const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", payment_intent: "pi_1", amount_total: 1050, currency: "eur", metadata: { orderId: "ord_1" } } } });
    const ev = await p.parseWebhook(creds, { rawBody: body, headers: { "stripe-signature": signStripePayload(body, "whsec_1") }, query: {} }, { sandbox: true });
    assert.deepEqual(ev, [{ type: "payment.succeeded", eventId: "evt_1", orderId: "ord_1", providerRef: "cs_1", providerPaymentId: "pi_1", amountMinor: 1050, currency: "EUR", providerSubscriptionId: null }]);

    await assert.rejects(p.parseWebhook(creds, { rawBody: body, headers: { "stripe-signature": signStripePayload(body, "whsec_forged") }, query: {} }, { sandbox: true }), WebhookVerificationError);

    const unpaid = JSON.stringify({ id: "evt_2", type: "checkout.session.completed", data: { object: { id: "cs_2", payment_status: "unpaid" } } });
    const ev2 = await p.parseWebhook(creds, { rawBody: unpaid, headers: { "stripe-signature": signStripePayload(unpaid, "whsec_1") }, query: {} }, { sandbox: true });
    assert.equal(ev2[0].type, "ignored", "unpaid sessions never activate");

    const renew = JSON.stringify({ id: "evt_3", type: "invoice.paid", data: { object: { id: "in_1", billing_reason: "subscription_cycle", subscription: "sub_1", payment_intent: "pi_2", amount_paid: 1050, currency: "eur" } } });
    const ev3 = await p.parseWebhook(creds, { rawBody: renew, headers: { "stripe-signature": signStripePayload(renew, "whsec_1") }, query: {} }, { sandbox: true });
    assert.deepEqual(ev3[0], { type: "subscription.renewed", eventId: "evt_3", providerSubscriptionId: "sub_1", providerPaymentId: "pi_2", amountMinor: 1050, currency: "EUR" });
  } finally {
    await s.close();
  }
});

test("Mollie: webhook trusts only API-fetched status", async () => {
  const s = await startServer(({ method, path }) => {
    if (method === "POST" && path === "/v2/payments") return { status: 201, json: { id: "tr_abc", _links: { checkout: { href: "https://mollie/checkout" } } } };
    if (path === "/v2/payments/tr_abc") return { json: { id: "tr_abc", status: "paid", amount: { value: "10.50", currency: "EUR" }, metadata: { orderId: "ord_1" } } };
    if (path === "/v2/payments/tr_open") return { json: { id: "tr_open", status: "open", amount: { value: "10.50", currency: "EUR" } } };
    return { status: 404, json: { detail: "not found" } };
  });
  try {
    const p = getProvider("MOLLIE");
    const creds = { apiKey: "test_x", apiBase: s.url };
    const r = await p.createCheckout(creds, input, { sandbox: true });
    assert.equal(r.providerRef, "tr_abc");
    assert.equal(JSON.parse(s.calls[0].body).amount.value, "10.50");
    const ev = await p.parseWebhook(creds, { rawBody: "id=tr_abc", headers: {}, query: {} }, { sandbox: true });
    assert.equal(ev[0].type, "payment.succeeded");
    assert.equal((ev[0] as any).amountMinor, 1050);
    const ev2 = await p.parseWebhook(creds, { rawBody: "id=tr_open", headers: {}, query: {} }, { sandbox: true });
    assert.equal(ev2[0].type, "ignored");
    const ev3 = await p.parseWebhook(creds, { rawBody: "id=../../etc", headers: {}, query: {} }, { sandbox: true });
    assert.equal(ev3[0].type, "ignored");
  } finally {
    await s.close();
  }
});

test("NOWPayments: invoice + signed IPN re-checked via API", async () => {
  const s = await startServer(({ path }) => {
    if (path === "/v1/invoice") return { json: { id: 99, invoice_url: "https://nowpayments.io/payment/?iid=99" } };
    if (path === "/v1/payment/555") return { json: { payment_id: 555, payment_status: "finished", order_id: "ord_1", price_amount: 10.5, price_currency: "eur" } };
    return { status: 404, json: {} };
  });
  try {
    const p = getProvider("NOWPAYMENTS");
    const creds = { apiKey: "k", ipnSecret: "ipn", apiBase: s.url };
    const r = await p.createCheckout(creds, input, { sandbox: true });
    assert.equal(r.redirectUrl, "https://nowpayments.io/payment/?iid=99");
    assert.equal(JSON.parse(s.calls[0].body).price_amount, 10.5);
    const body = { payment_id: 555, payment_status: "finished", order_id: "ord_1", invoice_id: 99, price_amount: 10.5, price_currency: "eur" };
    const raw = JSON.stringify(body);
    const ev = await p.parseWebhook(creds, { rawBody: raw, headers: { "x-nowpayments-sig": signNowPayments(body, "ipn") }, query: {} }, { sandbox: true });
    assert.equal(ev[0].type, "payment.succeeded");
    assert.equal((ev[0] as any).amountMinor, 1050);
    await assert.rejects(p.parseWebhook(creds, { rawBody: raw, headers: { "x-nowpayments-sig": "bad" }, query: {} }, { sandbox: true }), WebhookVerificationError);
  } finally {
    await s.close();
  }
});

test("PayPal: create order, capture on return, verified webhook", async () => {
  let verified = "SUCCESS";
  const s = await startServer(({ method, path }) => {
    if (path === "/v1/oauth2/token") return { json: { access_token: "AT" } };
    if (method === "POST" && path === "/v2/checkout/orders") return { status: 201, json: { id: "PP1", links: [{ rel: "approve", href: "https://paypal/approve/PP1" }] } };
    if (path === "/v2/checkout/orders/PP1/capture") return { status: 201, json: { id: "PP1", status: "COMPLETED", purchase_units: [{ custom_id: "ord_1", payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { value: "10.50", currency_code: "EUR" } }] } }] } };
    if (path === "/v1/notifications/verify-webhook-signature") return { json: { verification_status: verified } };
    return { status: 404, json: {} };
  });
  try {
    const p = getProvider("PAYPAL");
    const creds = { clientId: "id", clientSecret: "sec", webhookId: "WH", apiBase: s.url };
    const r = await p.createCheckout(creds, input, { sandbox: true });
    assert.deepEqual(r, { redirectUrl: "https://paypal/approve/PP1", providerRef: "PP1" });
    const ev = await p.confirmReturn!(creds, { token: "PP1" }, { sandbox: true });
    assert.deepEqual(ev[0], { type: "payment.succeeded", eventId: "capture:PP1", orderId: "ord_1", providerRef: "PP1", providerPaymentId: "CAP1", amountMinor: 1050, currency: "EUR" });
    const hook = JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1", custom_id: "ord_1", amount: { value: "10.50", currency_code: "EUR" } } });
    const ev2 = await p.parseWebhook(creds, { rawBody: hook, headers: {}, query: {} }, { sandbox: true });
    assert.equal(ev2[0].type, "payment.succeeded");
    verified = "FAILURE";
    await assert.rejects(p.parseWebhook(creds, { rawBody: hook, headers: {}, query: {} }, { sandbox: true }), WebhookVerificationError);
  } finally {
    await s.close();
  }
});
