export type ProviderCode = "STRIPE" | "PAYPAL" | "MOLLIE" | "NOWPAYMENTS" | "TEST" | "MANUAL";

export interface CheckoutInput {
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  webhookUrl: string;
  /** Present for auto-renewing packages (Stripe only). */
  recurring?: { durationDays: number };
}

export interface CheckoutResult {
  redirectUrl: string;
  providerRef: string;
}

export type PaymentEvent =
  | {
      type: "payment.succeeded";
      eventId: string;
      orderId?: string | null;
      providerRef?: string | null;
      providerPaymentId: string;
      amountMinor?: number | null;
      currency?: string | null;
      providerSubscriptionId?: string | null;
    }
  | {
      type: "subscription.renewed";
      eventId: string;
      providerSubscriptionId: string;
      providerPaymentId: string;
      amountMinor: number;
      currency: string;
    }
  | { type: "payment.failed"; eventId: string; orderId?: string | null; providerRef?: string | null; providerSubscriptionId?: string | null; reason: string }
  | { type: "refund"; eventId: string; providerPaymentId: string; amountMinor?: number | null; refundId: string }
  | { type: "subscription.canceled"; eventId: string; providerSubscriptionId: string }
  | { type: "ignored"; eventId: string; reason: string };

export interface WebhookRequest {
  rawBody: string;
  headers: Record<string, string>;
  query: Record<string, string>;
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export class PaymentProviderError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
}

export interface PaymentProviderImpl<C = Record<string, string>> {
  readonly code: ProviderCode;
  readonly label: string;
  readonly supportsRecurring: boolean;
  readonly supportsRefunds: boolean;
  readonly credentialFields: CredentialField[];
  createCheckout(creds: C, input: CheckoutInput, opts: { sandbox: boolean }): Promise<CheckoutResult>;
  /** Verifies authenticity and returns normalized events. Throws WebhookVerificationError if forged. */
  parseWebhook(creds: C, req: WebhookRequest, opts: { sandbox: boolean }): Promise<PaymentEvent[]>;
  /** Called when the buyer returns to the success URL (PayPal capture). */
  confirmReturn?(creds: C, params: Record<string, string>, opts: { sandbox: boolean }): Promise<PaymentEvent[]>;
  refund(creds: C, providerPaymentId: string, amountMinor: number, currency: string, opts: { sandbox: boolean }): Promise<{ refundId: string }>;
  cancelSubscription?(creds: C, providerSubscriptionId: string, opts: { sandbox: boolean }): Promise<void>;
  /** Lightweight credential check used by the "Test" button. */
  verifyCredentials(creds: C, opts: { sandbox: boolean }): Promise<string>;
}
