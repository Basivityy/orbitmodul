import { httpRequest } from "../http";
import { minorToDecimalString, parseAmountToMinor } from "../money";
import { CheckoutInput, PaymentEvent, PaymentProviderError, PaymentProviderImpl } from "./types";

export interface MollieCreds {
  apiKey: string;
  apiBase?: string; // tests only
}

/**
 * Mollie Payments API v2. Mollie webhooks carry only the payment id; authenticity is
 * guaranteed by fetching the payment from the API with the reseller's key.
 * Note: Mollie requires a publicly reachable webhook URL (not localhost).
 */
export class MollieProvider implements PaymentProviderImpl<MollieCreds> {
  readonly code = "MOLLIE" as const;
  readonly label = "Mollie";
  readonly supportsRecurring = false;
  readonly supportsRefunds = true;
  readonly credentialFields = [{ key: "apiKey", label: "API key (live_… or test_…)", secret: true, required: true }];

  private async api(c: MollieCreds, method: string, path: string, body?: unknown, idem?: string) {
    const res = await httpRequest((c.apiBase ?? "https://api.mollie.com") + path, {
      method,
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new PaymentProviderError(`Mollie: ${res.json?.detail ?? `HTTP ${res.status}`}`, res.status);
    return res.json;
  }

  async verifyCredentials(c: MollieCreds) {
    await this.api(c, "GET", "/v2/methods");
    return `Mollie key valid (${c.apiKey.startsWith("test_") ? "test" : "live"})`;
  }

  async createCheckout(c: MollieCreds, input: CheckoutInput) {
    const p = await this.api(c, "POST", "/v2/payments", {
      amount: { currency: input.currency.toUpperCase(), value: minorToDecimalString(input.amountMinor, input.currency) },
      description: `${input.description} (${input.orderNumber})`.slice(0, 255),
      redirectUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      webhookUrl: input.webhookUrl,
      metadata: { orderId: input.orderId },
    }, `checkout-${input.orderId}`);
    const href = p?._links?.checkout?.href;
    if (!href) throw new PaymentProviderError("Mollie did not return a checkout URL");
    return { redirectUrl: href as string, providerRef: String(p.id) };
  }

  async fetchPaymentEvents(c: MollieCreds, paymentId: string): Promise<PaymentEvent[]> {
    if (!/^tr_[A-Za-z0-9]+$/.test(paymentId)) return [{ type: "ignored", eventId: `invalid:${paymentId.slice(0, 40)}`, reason: "invalid id" }];
    const p = await this.api(c, "GET", `/v2/payments/${paymentId}`);
    const events: PaymentEvent[] = [];
    if (p.status === "paid") {
      events.push({ type: "payment.succeeded", eventId: `${p.id}:paid`, orderId: p.metadata?.orderId ?? null, providerRef: p.id, providerPaymentId: p.id, amountMinor: parseAmountToMinor(p.amount.value, p.amount.currency), currency: p.amount.currency });
      const refunded = p.amountRefunded ? parseAmountToMinor(p.amountRefunded.value, p.amountRefunded.currency) ?? 0 : 0;
      if (refunded > 0) events.push({ type: "refund", eventId: `${p.id}:refunded:${refunded}`, providerPaymentId: p.id, amountMinor: refunded, refundId: `${p.id}:${refunded}` });
    } else if (["failed", "expired", "canceled"].includes(p.status)) {
      events.push({ type: "payment.failed", eventId: `${p.id}:${p.status}`, orderId: p.metadata?.orderId ?? null, providerRef: p.id, reason: p.status });
    } else {
      events.push({ type: "ignored", eventId: `${p.id}:${p.status}`, reason: p.status });
    }
    return events;
  }

  async parseWebhook(c: MollieCreds, req: { rawBody: string }) {
    const id = new URLSearchParams(req.rawBody).get("id") ?? "";
    return this.fetchPaymentEvents(c, id);
  }

  async confirmReturn(c: MollieCreds, params: Record<string, string>) {
    return params.paymentId ? this.fetchPaymentEvents(c, params.paymentId) : [];
  }

  async refund(c: MollieCreds, paymentId: string, amountMinor: number, currency: string) {
    const r = await this.api(c, "POST", `/v2/payments/${encodeURIComponent(paymentId)}/refunds`, {
      amount: { currency: currency.toUpperCase(), value: minorToDecimalString(amountMinor, currency) },
    });
    return { refundId: String(r.id) };
  }
}
