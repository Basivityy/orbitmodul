import { MollieProvider } from "./mollie";
import { NowPaymentsProvider } from "./nowpayments";
import { PayPalProvider } from "./paypal";
import { StripeProvider } from "./stripe";
import { TestProvider } from "./test";
import { ManualProvider } from "./manual";
import { PaymentProviderImpl, ProviderCode } from "./types";

export * from "./types";

/** Registry — add a new provider by implementing PaymentProviderImpl and listing it here. */
const providers: Record<ProviderCode, PaymentProviderImpl<any>> = {
  STRIPE: new StripeProvider(),
  PAYPAL: new PayPalProvider(),
  MOLLIE: new MollieProvider(),
  NOWPAYMENTS: new NowPaymentsProvider(),
  TEST: new TestProvider(),
  MANUAL: new ManualProvider(),
};

/** Gateways a reseller can connect (MANUAL is internal: orders added by hand in the dashboard). */
export const PROVIDER_ORDER: ProviderCode[] = ["STRIPE", "PAYPAL", "MOLLIE", "NOWPAYMENTS", "TEST"];

export function getProvider(code: ProviderCode | string): PaymentProviderImpl<any> {
  const p = providers[code as ProviderCode];
  if (!p) throw new Error(`Unknown payment provider ${code}`);
  return p;
}
