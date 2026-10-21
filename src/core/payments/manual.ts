import { PaymentEvent, PaymentProviderError, PaymentProviderImpl } from "./types";

/**
 * Internal "provider" for customers added by hand by the reseller (cash, bank transfer,
 * free lines). No checkout, no webhooks — the order is created already paid.
 */
export class ManualProvider implements PaymentProviderImpl<Record<string, string>> {
  readonly code = "MANUAL" as const;
  readonly label = "Manual (added by reseller)";
  readonly supportsRecurring = false;
  readonly supportsRefunds = false;
  readonly credentialFields = [];

  async verifyCredentials() {
    return "Manual orders need no credentials";
  }
  async createCheckout(): Promise<{ redirectUrl: string; providerRef: string }> {
    throw new PaymentProviderError("Manual orders have no checkout.");
  }
  async parseWebhook(): Promise<PaymentEvent[]> {
    return [];
  }
  async refund(): Promise<{ refundId: string }> {
    throw new PaymentProviderError("Manual payments are refunded outside the system.");
  }
}
