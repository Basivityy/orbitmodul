import { formEncode, httpRequest } from "../http";
import { recurringInterval } from "../dates";
import { verifyStripeSignature } from "../signatures";
import { CheckoutInput, PaymentEvent, PaymentProviderError, PaymentProviderImpl, WebhookVerificationError } from "./types";

export interface StripeCreds {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string; // tests only
}

/**
 * Stripe Checkout using the reseller's own Stripe account (money goes directly to the reseller).
 * Webhook events: checkout.session.completed / async_payment_succeeded / async_payment_failed / expired,
 * invoice.paid (subscription_cycle renewals), invoice.payment_failed, customer.subscription.deleted, charge.refunded.
 */
export class StripeProvider implements PaymentProviderImpl<StripeCreds> {
  readonly code = "STRIPE" as const;
  readonly label = "Stripe";
  readonly supportsRecurring = true;
  readonly supportsRefunds = true;
  readonly credentialFields = [
    { key: "secretKey", label: "Secret key (sk_live_… / sk_test_… or restricted rk_…)", secret: true, required: true },
    { key: "webhookSecret", label: "Webhook signing secret (whsec_…)", secret: true, required: true, help: "Create a webhook endpoint in Stripe pointing to the URL shown below." },
  ];

  private base(c: StripeCreds) {
    return c.apiBase ?? "https://api.stripe.com";
  }

  private async api(c: StripeCreds, method: string, path: string, form?: Record<string, any>, idempotencyKey?: string) {
    const res = await httpRequest(this.base(c) + path, {
      method,
      headers: {
        Authorization: `Bearer ${c.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2024-06-20",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form ? formEncode(form) : undefined,
    });
    if (!res.ok) throw new PaymentProviderError(`Stripe: ${res.json?.error?.message ?? `HTTP ${res.status}`}`, res.status);
    return res.json;
  }

  async verifyCredentials(c: StripeCreds) {
    const acct = await this.api(c, "GET", "/v1/balance");
    return `Stripe key valid${acct?.livemode === false ? " (test mode)" : ""}`;
  }

  async createCheckout(c: StripeCreds, input: CheckoutInput) {
    const cur = input.currency.toLowerCase();
    const form: Record<string, any> = {
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      client_reference_id: input.orderId,
      "metadata[orderId]": input.orderId,
      "metadata[orderNumber]": input.orderNumber,
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": cur,
      "line_items[0][price_data][unit_amount]": input.amountMinor,
      "line_items[0][price_data][product_data][name]": input.description,
    };
    if (input.recurring) {
      const { interval, count } = recurringInterval(input.recurring.durationDays);
      form.mode = "subscription";
      form["line_items[0][price_data][recurring][interval]"] = interval;
      form["line_items[0][price_data][recurring][interval_count]"] = count;
      form["subscription_data[metadata][orderId]"] = input.orderId;
    } else {
      form.mode = "payment";
      form["payment_intent_data[metadata][orderId]"] = input.orderId;
    }
    const session = await this.api(c, "POST", "/v1/checkout/sessions", form, `checkout-${input.orderId}`);
    if (!session?.url) throw new PaymentProviderError("Stripe did not return a checkout URL");
    return { redirectUrl: session.url as string, providerRef: session.id as string };
  }

  async parseWebhook(c: StripeCreds, req: { rawBody: string; headers: Record<string, string> }): Promise<PaymentEvent[]> {
    if (!verifyStripeSignature(req.rawBody, req.headers["stripe-signature"], c.webhookSecret)) {
      throw new WebhookVerificationError("Invalid Stripe signature");
    }
    const evt = JSON.parse(req.rawBody);
    const o = evt?.data?.object ?? {};
    const id = String(evt.id);
    switch (evt.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") {
          return [{ type: "ignored", eventId: id, reason: `payment_status=${o.payment_status}` }];
        }
        return [{
          type: "payment.succeeded",
          eventId: id,
          orderId: o.metadata?.orderId ?? o.client_reference_id ?? null,
          providerRef: o.id,
          providerPaymentId: String(o.payment_intent ?? o.invoice ?? o.id),
          amountMinor: typeof o.amount_total === "number" ? o.amount_total : null,
          currency: o.currency ? String(o.currency).toUpperCase() : null,
          providerSubscriptionId: o.subscription ?? null,
        }];
      }
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        return [{ type: "payment.failed", eventId: id, orderId: o.metadata?.orderId ?? o.client_reference_id ?? null, providerRef: o.id, reason: evt.type }];
      case "invoice.paid": {
        const subId = o.subscription ?? o.parent?.subscription_details?.subscription ?? null;
        if (!subId || o.billing_reason !== "subscription_cycle") return [{ type: "ignored", eventId: id, reason: `invoice ${o.billing_reason}` }];
        return [{ type: "subscription.renewed", eventId: id, providerSubscriptionId: String(subId), providerPaymentId: String(o.payment_intent ?? o.id), amountMinor: o.amount_paid, currency: String(o.currency).toUpperCase() }];
      }
      case "invoice.payment_failed": {
        const subId = o.subscription ?? o.parent?.subscription_details?.subscription ?? null;
        return [{ type: "payment.failed", eventId: id, providerSubscriptionId: subId, reason: "Renewal payment failed" }];
      }
      case "customer.subscription.deleted":
        return [{ type: "subscription.canceled", eventId: id, providerSubscriptionId: String(o.id) }];
      case "charge.refunded":
        return [{ type: "refund", eventId: id, providerPaymentId: String(o.payment_intent ?? o.id), amountMinor: o.amount_refunded ?? null, refundId: `${o.id}:${o.amount_refunded}` }];
      default:
        return [{ type: "ignored", eventId: id, reason: evt.type }];
    }
  }

  async refund(c: StripeCreds, providerPaymentId: string, amountMinor: number) {
    if (!providerPaymentId.startsWith("pi_")) throw new PaymentProviderError("Only card payments (payment_intent) can be refunded from here; refund invoice payments in the Stripe dashboard.");
    const r = await this.api(c, "POST", "/v1/refunds", { payment_intent: providerPaymentId, amount: amountMinor }, `refund-${providerPaymentId}-${amountMinor}`);
    return { refundId: String(r.id) };
  }

  async cancelSubscription(c: StripeCreds, providerSubscriptionId: string) {
    await this.api(c, "POST", `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { cancel_at_period_end: "true" });
  }
}
