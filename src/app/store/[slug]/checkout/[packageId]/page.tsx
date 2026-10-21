import Link from "next/link";
import { notFound } from "next/navigation";
import { randomToken } from "@/core/crypto";
import { getProvider } from "@/core/payments";
import { effectivePrice } from "@/core/pricing";
import { SubmitButton } from "@/components/client";
import { Flash, Money } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth";
import { db } from "@/lib/db";
import { enabledGateways } from "@/lib/gateways";
import { storeTestPaymentsEnabled } from "@/lib/settings";
import { resolveStore } from "@/lib/storefront";
import { checkoutAction } from "../../actions";
import { verifyRenewToken } from "@/core/renewToken";
import { CUSTOMER_USERNAME_RULE } from "@/core/usernames";
import { isPlaceholderEmail } from "@/core/importedCustomers";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ slug: string; packageId: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug, packageId }, sp] = await Promise.all([params, searchParams]);
  const { reseller, base, canSell } = await resolveStore(slug);
  const pkg = await db.package.findFirst({ where: { id: packageId, resellerId: reseller.id, active: true }, include: { bouquets: { include: { bouquet: true } } } });
  if (!pkg) notFound();
  const testPayments = await storeTestPaymentsEnabled();
  const gateways = await enabledGateways(reseller.id);
  const customer = sp.renew ? await getCurrentCustomer(reseller.id) : null;
  const portalRenewal = sp.renew && customer ? await db.subscription.findFirst({ where: { id: sp.renew, customerId: customer.id } }) : null;
  // Renewal by line username (signed link from the "Extend your subscription" page).
  const lineRenewal = !portalRenewal && sp.line && verifyRenewToken(sp.line, sp.t) ? await db.subscription.findFirst({ where: { id: sp.line, resellerId: reseller.id }, include: { customer: true } }) : null;
  const renewing = portalRenewal ?? lineRenewal;
  const lineEmail = lineRenewal && !isPlaceholderEmail(lineRenewal.customer.email) ? lineRenewal.customer.email : "";
  const price = effectivePrice(pkg);
  return (
    <div className="mx-auto grid max-w-4xl gap-8 md:grid-cols-5">
      <div className="md:col-span-3">
        <h1 className="mb-2">{renewing ? "Extend your line" : "Buy a new line"}</h1>
        {!renewing && <p className="muted mb-6 text-sm">Already have a line? <Link href={`${base}/renew`}>Extend your existing line instead →</Link></p>}
        {renewing && <div className="mb-6" />}
        <Flash sp={sp} />
        {!canSell ? (
          <p className="card card-pad">This store is not accepting orders right now.</p>
        ) : gateways.length === 0 && !testPayments ? (
          <p className="card card-pad">No payment methods are available yet. Please contact the store.</p>
        ) : (
          <form action={checkoutAction} className="card card-pad space-y-5">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="packageId" value={pkg.id} />
            <input type="hidden" name="idem" value={randomToken(16)} />
            {portalRenewal && <input type="hidden" name="renew" value={portalRenewal.id} />}
            {lineRenewal && <input type="hidden" name="line" value={lineRenewal.id} />}
            {lineRenewal && <input type="hidden" name="t" value={sp.t} />}
            {lineRenewal && (
              <div className="rounded-lg bg-slate-100 px-4 py-3 text-sm dark:bg-slate-800">
                Extending line <b className="font-mono">{lineRenewal.lineUsername}</b> — username and password stay the same.
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email address</label>
              <input className="input" id="email" name="email" type="email" required autoComplete="email" defaultValue={customer?.email ?? lineEmail} readOnly={!!portalRenewal || !!lineEmail} />
              <p className="hint">Your access details and receipt are sent here.</p>
            </div>
            {!renewing && (
              <div>
                <label className="label" htmlFor="lineUsername">Choose your username</label>
                <input className="input font-mono" id="lineUsername" name="lineUsername" required minLength={8} maxLength={30} pattern="(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{8,30}" title={CUSTOMER_USERNAME_RULE} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. marko2026" />
                <p className="hint">{CUSTOMER_USERNAME_RULE}. You sign in to the app with this username — remember it. Your password is created automatically and shown after payment.</p>
              </div>
            )}
            {!renewing && (
              <div>
                <label className="label" htmlFor="name">Name (optional)</label>
                <input className="input" id="name" name="name" autoComplete="name" maxLength={100} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="coupon">Coupon code (optional)</label>
              <input className="input font-mono uppercase" id="coupon" name="coupon" maxLength={30} />
            </div>
            <fieldset>
              <legend className="label">Payment method</legend>
              <div className="space-y-2">
                {testPayments && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 dark:bg-amber-500/10">
                    <input type="radio" name="provider" value="TEST" defaultChecked className="h-4 w-4" />
                    <span className="font-medium">Test payment</span>
                    <span className="muted text-xs">simulated — no real money</span>
                  </label>
                )}
                {gateways.map((g, i) => (
                  <label key={g.provider} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700">
                    <input type="radio" name="provider" value={g.provider} defaultChecked={!testPayments && i === 0} className="h-4 w-4" />
                    <span className="font-medium">{getProvider(g.provider).label}</span>
                    {g.provider === "STRIPE" && <span className="muted text-xs">Card · Apple Pay · Google Pay</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" name="terms" required className="checkbox mt-0.5" />
              <span>
                I agree to the {reseller.termsText ? <Link href={`${base}/terms`} target="_blank">terms of service</Link> : "terms of service"}
                {reseller.refundPolicy && <> and <Link href={`${base}/refund-policy`} target="_blank">refund policy</Link></>}.
              </span>
            </label>
            <SubmitButton className="btn w-full py-3 text-base text-white" style={{ background: "var(--brand)" }}>Pay <Money amount={price.amount} currency={pkg.currency} /></SubmitButton>
            <p className="hint text-center">You will be redirected to a secure payment page. Your line is activated automatically after payment is confirmed.</p>
          </form>
        )}
      </div>
      <aside className="md:col-span-2">
        <div className="card card-pad sticky top-6">
          <h2 className="mb-1">{pkg.name}</h2>
          <p className="muted mb-4">{pkg.durationDays} days · {pkg.maxConnections} connection{pkg.maxConnections > 1 ? "s" : ""}{pkg.billingType === "RECURRING" && !renewing ? " · renews automatically (card)" : ""}</p>
          <ul className="mb-4 space-y-1 text-sm">{pkg.bouquets.map((b) => <li key={b.bouquetId}>✓ {b.bouquet.name}</li>)}</ul>
          <div className="flex items-baseline justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
            <span className="muted">Total</span>
            <span className="text-2xl font-bold"><Money amount={price.amount} currency={pkg.currency} /></span>
          </div>
          {price.isPromo && <p className="hint text-right">Promotional price (regular <Money amount={pkg.priceCents} currency={pkg.currency} />)</p>}
          <p className="hint mt-2">Coupon discounts are applied on the payment page.</p>
        </div>
      </aside>
    </div>
  );
}
