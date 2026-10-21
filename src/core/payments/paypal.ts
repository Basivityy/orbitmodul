import { httpRequest } from "../http";
import { minorToDecimalString, parseAmountToMinor } from "../money";
import { CheckoutInput, PaymentEvent, PaymentProviderError, PaymentProviderImpl, WebhookVerificationError } from "./types";

export interface PayPalCreds {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  apiBase?: string; // tests only
}

/**
 * PayPal Orders v2 (intent CAPTURE) on the reseller's own PayPal business account.
 * Payment is confirmed either when the buyer returns (server-side capture) or by the
 * PAYMENT.CAPTURE.COMPLETED webhook (verified with /v1/notifications/verify-webhook-signature).
 * Both paths are idempotent. Auto-renewal is not offered for PayPal (one-time payments + renewal links).
 */
export class PayPalProvider implements PaymentProviderImpl<PayPalCreds> {
  readonly code = "PAYPAL" as const;
  readonly label = "PayPal";
  readonly supportsRecurring = false;
  readonly supportsRefunds = true;
  readonly credentialFields = [
    { key: "clientId", label: "REST API Client ID", secret: false, required: true },
    { key: "clientSecret", label: "REST API Secret", secret: true, required: true },
    { key: "webhookId", label: "Webhook ID", secret: false, required: true, help: "Create a webhook in the PayPal developer dashboard pointing to the URL below and paste its ID." },
  ];

  private base(c: PayPalCreds, sandbox: boolean) {
    return c.apiBase ?? (sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");
  }

  private async token(c: PayPalCreds, sandbox: boolean): Promise<string> {
    const res = await httpRequest(this.base(c, sandbox) + "/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok || !res.json?.access_token) throw new PaymentProviderError(`PayPal auth failed (HTTP ${res.status})`, res.status);
    return res.json.access_token;
  }

  private async api(c: PayPalCreds, sandbox: boolean, method: string, path: string, body?: unknown, requestId?: string) {
    const tok = await this.token(c, sandbox);
    const res = await httpRequest(this.base(c, sandbox) + path, {
      method,
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  async verifyCredentials(c: PayPalCreds, { sandbox }: { sandbox: boolean }) {
    await this.token(c, sandbox);
    return `PayPal credentials valid (${sandbox ? "sandbox" : "live"})`;
  }

  async createCheckout(c: PayPalCreds, input: CheckoutInput, { sandbox }: { sandbox: boolean }) {
    const res = await this.api(c, sandbox, "POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: input.orderId,
        custom_id: input.orderId,
        invoice_id: input.orderNumber,
        description: input.description.slice(0, 127),
        amount: { currency_code: input.currency.toUpperCase(), value: minorToDecimalString(input.amountMinor, input.currency) },
      }],
      application_context: { return_url: input.successUrl, cancel_url: input.cancelUrl, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING" },
    }, `create-${input.orderId}`);
    if (!res.ok) throw new PaymentProviderError(`PayPal: ${res.json?.message ?? `HTTP ${res.status}`}`, res.status);
    const approve = (res.json?.links ?? []).find((l: any) => l.rel === "approve" || l.rel === "payer-action");
    if (!approve) throw new PaymentProviderError("PayPal did not return an approval link");
    return { redirectUrl: approve.href as string, providerRef: String(res.json.id) };
  }

  private capturedEvents(order: any, eventId: string): PaymentEvent[] {
    const pu = order?.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    if (order?.status !== "COMPLETED" || !cap || cap.status !== "COMPLETED") {
      return [{ type: "ignored", eventId, reason: `order status ${order?.status}` }];
    }
    return [{
      type: "payment.succeeded",
      eventId,
      orderId: pu.custom_id ?? pu.reference_id ?? null,
      providerRef: String(order.id),
      providerPaymentId: String(cap.id),
      amountMinor: parseAmountToMinor(cap.amount.value, cap.amount.currency_code),
      currency: cap.amount.currency_code,
    }];
  }

  /** Capture an approved order. Safe to call repeatedly. */
  async capture(c: PayPalCreds, paypalOrderId: string, sandbox: boolean): Promise<PaymentEvent[]> {
    const res = await this.api(c, sandbox, "POST", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {}, `capture-${paypalOrderId}`);
    if (res.ok) return this.capturedEvents(res.json, `capture:${paypalOrderId}`);
    if (res.status === 422) {
      // e.g. ORDER_ALREADY_CAPTURED — read the order instead
      const get = await this.api(c, sandbox, "GET", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
      if (get.ok) return this.capturedEvents(get.json, `capture:${paypalOrderId}`);
    }
    throw new PaymentProviderError(`PayPal capture failed: ${res.json?.message ?? `HTTP ${res.status}`}`, res.status);
  }

  async confirmReturn(c: PayPalCreds, params: Record<string, string>, { sandbox }: { sandbox: boolean }) {
    const token = params.token;
    if (!token) return [];
    return this.capture(c, token, sandbox);
  }

  async parseWebhook(c: PayPalCreds, req: { rawBody: string; headers: Record<string, string> }, { sandbox }: { sandbox: boolean }): Promise<PaymentEvent[]> {
    const h = req.headers;
    const event = JSON.parse(req.rawBody);
    const verify = await this.api(c, sandbox, "POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h["paypal-auth-algo"],
      cert_url: h["paypal-cert-url"],
      transmission_id: h["paypal-transmission-id"],
      transmission_sig: h["paypal-transmission-sig"],
      transmission_time: h["paypal-transmission-time"],
      webhook_id: c.webhookId,
      webhook_event: event,
    });
    if (!verify.ok || verify.json?.verification_status !== "SUCCESS") throw new WebhookVerificationError("PayPal webhook signature verification failed");
    const r = event.resource ?? {};
    const id = String(event.id);
    switch (event.event_type) {
      case "CHECKOUT.ORDER.APPROVED":
        // Buyer approved but may have closed the window before returning: capture server-side.
        return this.capture(c, String(r.id), sandbox);
      case "PAYMENT.CAPTURE.COMPLETED": {
        const orderRef = r.supplementary_data?.related_ids?.order_id ?? null;
        return [{ type: "payment.succeeded", eventId: id, orderId: r.custom_id ?? null, providerRef: orderRef, providerPaymentId: String(r.id), amountMinor: parseAmountToMinor(r.amount?.value ?? "", r.amount?.currency_code ?? "EUR"), currency: r.amount?.currency_code ?? null }];
      }
      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.DECLINED":
        return [{ type: "payment.failed", eventId: id, orderId: r.custom_id ?? null, reason: event.event_type }];
      case "PAYMENT.CAPTURE.REFUNDED": {
        const up = (r.links ?? []).find((l: any) => l.rel === "up");
        const captureId = up ? String(up.href).split("/").pop() : null;
        if (!captureId) return [{ type: "ignored", eventId: id, reason: "refund without capture link" }];
        return [{ type: "refund", eventId: id, providerPaymentId: captureId, amountMinor: parseAmountToMinor(r.amount?.value ?? "", r.amount?.currency_code ?? "EUR"), refundId: String(r.id) }];
      }
      default:
        return [{ type: "ignored", eventId: id, reason: event.event_type }];
    }
  }

  async refund(c: PayPalCreds, captureId: string, amountMinor: number, currency: string, { sandbox }: { sandbox: boolean }) {
    const res = await this.api(c, sandbox, "POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      amount: { value: minorToDecimalString(amountMinor, currency), currency_code: currency.toUpperCase() },
    }, `refund-${captureId}-${amountMinor}`);
    if (!res.ok) throw new PaymentProviderError(`PayPal refund failed: ${res.json?.message ?? `HTTP ${res.status}`}`, res.status);
    return { refundId: String(res.json.id) };
  }
}
