import { httpRequest } from "../http";
import { minorToDecimalString, parseAmountToMinor } from "../money";
import { verifyNowPaymentsSignature } from "../signatures";
import { CheckoutInput, PaymentEvent, PaymentProviderError, PaymentProviderImpl, WebhookVerificationError } from "./types";

export interface NowPaymentsCreds {
  apiKey: string;
  ipnSecret: string;
  apiBase?: string; // tests only
}

/**
 * NOWPayments (crypto) hosted invoices. IPN callbacks are verified with HMAC-SHA512
 * (x-nowpayments-sig) and the payment status is re-read from the API before it is trusted.
 * Refunds are not available via API — handle them in the NOWPayments dashboard.
 */
export class NowPaymentsProvider implements PaymentProviderImpl<NowPaymentsCreds> {
  readonly code = "NOWPAYMENTS" as const;
  readonly label = "NOWPayments (crypto)";
  readonly supportsRecurring = false;
  readonly supportsRefunds = false;
  readonly credentialFields = [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "ipnSecret", label: "IPN secret key", secret: true, required: true },
  ];

  private base(c: NowPaymentsCreds, sandbox: boolean) {
    return c.apiBase ?? (sandbox ? "https://api-sandbox.nowpayments.io" : "https://api.nowpayments.io");
  }

  private async api(c: NowPaymentsCreds, sandbox: boolean, method: string, path: string, body?: unknown) {
    const res = await httpRequest(this.base(c, sandbox) + path, {
      method,
      headers: { "x-api-key": c.apiKey, "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new PaymentProviderError(`NOWPayments: ${res.json?.message ?? `HTTP ${res.status}`}`, res.status);
    return res.json;
  }

  async verifyCredentials(c: NowPaymentsCreds, { sandbox }: { sandbox: boolean }) {
    await this.api(c, sandbox, "GET", "/v1/merchant/coins");
    return "NOWPayments API key valid";
  }

  async createCheckout(c: NowPaymentsCreds, input: CheckoutInput, { sandbox }: { sandbox: boolean }) {
    const inv = await this.api(c, sandbox, "POST", "/v1/invoice", {
      price_amount: Number(minorToDecimalString(input.amountMinor, input.currency)),
      price_currency: input.currency.toLowerCase(),
      order_id: input.orderId,
      order_description: `${input.description} (${input.orderNumber})`,
      ipn_callback_url: input.webhookUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!inv?.invoice_url) throw new PaymentProviderError("NOWPayments did not return an invoice URL");
    return { redirectUrl: inv.invoice_url as string, providerRef: String(inv.id) };
  }

  async parseWebhook(c: NowPaymentsCreds, req: { rawBody: string; headers: Record<string, string> }, { sandbox }: { sandbox: boolean }): Promise<PaymentEvent[]> {
    let body: any;
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      throw new WebhookVerificationError("Invalid JSON");
    }
    if (!verifyNowPaymentsSignature(body, req.headers["x-nowpayments-sig"], c.ipnSecret)) throw new WebhookVerificationError("Invalid NOWPayments signature");
    const paymentId = String(body.payment_id ?? "");
    // Defense in depth: re-read the payment from the API.
    const p = paymentId ? await this.api(c, sandbox, "GET", `/v1/payment/${encodeURIComponent(paymentId)}`) : body;
    const status = String(p.payment_status ?? body.payment_status);
    const eventId = `${paymentId}:${status}`;
    if (status === "finished" || status === "confirmed") {
      const cur = String(p.price_currency ?? body.price_currency ?? "").toUpperCase();
      return [{
        type: "payment.succeeded",
        eventId: `${paymentId}:paid`,
        orderId: String(p.order_id ?? body.order_id ?? "") || null,
        providerRef: body.invoice_id ? String(body.invoice_id) : null,
        providerPaymentId: paymentId,
        amountMinor: cur ? parseAmountToMinor(String(p.price_amount ?? body.price_amount), cur) : null,
        currency: cur || null,
      }];
    }
    if (status === "failed" || status === "expired") return [{ type: "payment.failed", eventId, orderId: String(body.order_id ?? "") || null, reason: status }];
    return [{ type: "ignored", eventId, reason: status }];
  }

  async refund(): Promise<{ refundId: string }> {
    throw new PaymentProviderError("NOWPayments does not support refunds via API. Refund the customer from the NOWPayments dashboard.");
  }
}
