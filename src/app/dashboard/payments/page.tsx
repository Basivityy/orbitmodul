import { decryptJson, maskSecret } from "@/core/crypto";
import { getProvider, PROVIDER_ORDER } from "@/core/payments";
import { CopyButton, SubmitButton } from "@/components/client";
import { Card, Field, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { webhookUrl } from "@/lib/urls";
import { deleteGatewayAction, saveGatewayAction, testGatewayAction } from "../actions/integrations";

export const metadata = { title: "Payment gateways" };

const NOTES: Record<string, string> = {
  STRIPE: "Cards, Apple Pay, Google Pay. Supports automatic renewals. In Stripe → Developers → Webhooks add the URL below with events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, invoice.paid, invoice.payment_failed, customer.subscription.deleted, charge.refunded.",
  PAYPAL: "PayPal and cards via PayPal. Create a REST app in the PayPal developer dashboard and add a webhook with events PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED, CHECKOUT.ORDER.APPROVED.",
  MOLLIE: "iDEAL, Bancontact, cards, SEPA and more. Mollie calls the webhook URL automatically — nothing to configure there.",
  NOWPAYMENTS: "Crypto payments. In NOWPayments → Settings → Payments set the IPN secret; the IPN callback URL is sent with every invoice automatically.",
  TEST: "Simulated payments for testing the full flow from your dashboard. Never shown to customers.",
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const rows = await db.paymentGateway.findMany({ where: { resellerId: reseller.id } });
  return (
    <>
      <PageHeader title="Payment gateways" description="Connect your own accounts. Customers pay you directly — the money goes to your payment account, not to the platform." />
      <Flash sp={sp} />
      <div className="grid gap-6 xl:grid-cols-2">
        {PROVIDER_ORDER.map((code) => {
          const impl = getProvider(code);
          const row = rows.find((r) => r.provider === code);
          const creds = row ? decryptJson<Record<string, string>>(row.credentialsEnc) : {};
          return (
            <Card
              key={code}
              title={<span className="flex items-center gap-2">{impl.label} {row ? (row.enabled ? <span className="badge-green">enabled</span> : <span className="badge-gray">disabled</span>) : <span className="badge-gray">not connected</span>} {row?.sandbox && code !== "TEST" && <span className="badge-amber">sandbox</span>}</span>}
              description={NOTES[code]}
            >
              <form action={saveGatewayAction} className="space-y-4">
                <input type="hidden" name="provider" value={code} />
                {impl.credentialFields.map((f) => (
                  <Field key={f.key} label={f.label} name={`cred_${f.key}`} hint={f.help}>
                    <input
                      className="input font-mono"
                      id={`cred_${f.key}`}
                      name={`cred_${f.key}`}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      defaultValue={f.secret ? "" : creds[f.key] ?? ""}
                      placeholder={f.secret && creds[f.key] ? `${maskSecret(creds[f.key])} (unchanged)` : ""}
                    />
                  </Field>
                ))}
                {row && code !== "TEST" && (
                  <div>
                    <div className="label">Webhook URL</div>
                    <div className="flex items-center gap-2">
                      <code className="block flex-1 break-all text-xs">{webhookUrl(code, row.webhookToken)}</code>
                      <CopyButton text={webhookUrl(code, row.webhookToken)} />
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-6">
                  <Toggle name="enabled" label="Enabled" defaultChecked={row?.enabled ?? true} />
                  {code !== "TEST" && code !== "MOLLIE" && code !== "STRIPE" && <Toggle name="sandbox" label="Sandbox / test environment" defaultChecked={row?.sandbox ?? true} />}
                  {(code === "STRIPE" || code === "MOLLIE") && <input type="hidden" name="sandbox" value="" />}
                </div>
                {(code === "STRIPE" || code === "MOLLIE") && <p className="hint">Test vs live is determined by the key you enter (sk_test_/test_ vs live keys).</p>}
                <div className="flex flex-wrap gap-2">
                  <SubmitButton>{row ? "Save" : "Connect"}</SubmitButton>
                  {row && (
                    <>
                      <SubmitButton className="btn-secondary" formAction={testGatewayAction}>Test credentials</SubmitButton>
                      <SubmitButton className="btn-ghost text-rose-600" formAction={deleteGatewayAction} confirm={`Disconnect ${impl.label}?`}>Disconnect</SubmitButton>
                    </>
                  )}
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </>
  );
}
