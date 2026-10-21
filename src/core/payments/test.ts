import { CheckoutInput, PaymentEvent, PaymentProviderImpl } from "./types";

/**
 * Built-in test gateway. Only the reseller (logged in) can complete a test payment from
 * the dashboard; it is never offered on the public storefront. Use it together with
 * panel "test mode" to exercise the full flow without real money or real lines.
 */
export class TestProvider implements PaymentProviderImpl<Record<string, string>> {
  readonly code = "TEST" as const;
  readonly label = "Test gateway (dashboard only)";
  readonly supportsRecurring = false;
  readonly supportsRefunds = true;
  readonly credentialFields = [];

  async verifyCredentials() {
    return "Test gateway is always available";
  }

  async createCheckout(_c: Record<string, string>, input: CheckoutInput) {
    return { redirectUrl: `${new URL(input.successUrl).origin}/dashboard/test-pay/${input.orderId}`, providerRef: `test_${input.orderId}` };
  }

  async parseWebhook(): Promise<PaymentEvent[]> {
    return [];
  }

  static paidEvent(orderId: string, amountMinor: number, currency: string): PaymentEvent {
    return { type: "payment.succeeded", eventId: `test:${orderId}`, orderId, providerRef: `test_${orderId}`, providerPaymentId: `test_pay_${orderId}`, amountMinor, currency };
  }

  async refund(_c: Record<string, string>, providerPaymentId: string) {
    return { refundId: `test_refund_${providerPaymentId}` };
  }
}
