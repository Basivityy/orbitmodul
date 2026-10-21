import Link from "next/link";
import { decrypt } from "@/core/crypto";
import { Secret, SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, StatusBadge } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveStore } from "@/lib/storefront";
import { AppGuideCard } from "@/components/AppGuideCard";
import { appIconUrl, getAppGuide } from "@/lib/appGuide";
import { portalCancelAutoRenewAction, portalLoginAction, portalLogoutAction } from "../actions";

export const metadata = { title: "My account" };

export default async function PortalPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { reseller, base, canSell } = await resolveStore(slug);
  const customer = await getCurrentCustomer(reseller.id);
  const guide = await getAppGuide();

  if (!customer) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card card-pad sm:p-8">
          <h1 className="mb-1">My account</h1>
          <p className="muted mb-6">Enter the email you used to purchase. We will send you a secure sign-in link.</p>
          <Flash sp={sp} />
          <form action={portalLoginAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input className="input" name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
            <SubmitButton className="btn w-full text-white" style={{ background: "var(--brand)" }}>Email me a sign-in link</SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  const [subs, orders, invoices] = await Promise.all([
    db.subscription.findMany({ where: { customerId: customer.id, resellerId: reseller.id, status: { not: "PENDING" } }, include: { package: true }, orderBy: { createdAt: "desc" } }),
    db.order.findMany({ where: { customerId: customer.id, resellerId: reseller.id, status: { in: ["COMPLETED", "PAID", "ACTIVATING", "REFUNDED", "ACTIVATION_FAILED", "ON_HOLD"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.invoice.findMany({ where: { customerId: customer.id, resellerId: reseller.id }, orderBy: { issuedAt: "desc" }, take: 50 }),
  ]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>My account</h1>
          <p className="muted">{customer.email}</p>
        </div>
        <form action={portalLogoutAction}><input type="hidden" name="slug" value={slug} /><SubmitButton className="btn-secondary btn-sm">Sign out</SubmitButton></form>
      </div>
      <Flash sp={sp} />
      <div className="space-y-6">
        {subs.length === 0 && <Card><p className="muted">No subscriptions yet. <Link href={base || "/"}>Browse packages</Link></p></Card>}
        {subs.map((s) => (
          <Card key={s.id} title={<span className="flex items-center gap-2">{s.package.name} <StatusBadge status={s.status} /></span>} description={<>Valid until <DateTime value={s.expiresAt} /></>}>
            <div className="grid gap-4 sm:grid-cols-2">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2"><dt className="muted">Username</dt><dd><code className="select-all">{s.lineUsername ?? "—"}</code></dd></div>
                <div className="flex justify-between gap-2"><dt className="muted">Password</dt><dd>{s.linePasswordEnc ? <Secret value={decrypt(s.linePasswordEnc)} /> : "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="muted">Connections</dt><dd>{s.package.maxConnections}</dd></div>
                <div className="flex justify-between gap-2"><dt className="muted">Renewal</dt><dd>{s.autoRenew ? "Automatic" : "Manual"}</dd></div>
                {s.maxPlayerStatus === "ACTIVE" && <div className="flex justify-between gap-2"><dt className="muted">MaxPlayer</dt><dd>Active — sign in with the same username and password</dd></div>}
              </dl>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                {canSell && s.package.active && !s.autoRenew && (
                  <Link href={`${base}/checkout/${s.packageId}?renew=${s.id}`} className="btn text-white" style={{ background: "var(--brand)" }}>Renew / extend</Link>
                )}
                {s.autoRenew && (
                  <form action={portalCancelAutoRenewAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="subscriptionId" value={s.id} />
                    <SubmitButton className="btn-secondary" confirm="Stop automatic renewal? Your access stays active until the expiry date.">Cancel automatic renewal</SubmitButton>
                  </form>
                )}
              </div>
            </div>
            {guide.enabled && s.lineUsername && s.linePasswordEnc && (s.maxPlayerStatus === "ACTIVE" || s.maxPlayerStatus === "PENDING") && (
              <div className="mt-5"><AppGuideCard guide={guide} iconUrl={appIconUrl(guide)} username={s.lineUsername} password={decrypt(s.linePasswordEnc)} /></div>
            )}
          </Card>
        ))}

        <Card title="Payments & invoices" pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Order</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
              <tbody>
                {orders.map((o) => {
                  const inv = invoices.find((i) => i.orderId === o.id);
                  return (
                    <tr key={o.id}>
                      <td><DateTime value={o.createdAt} dateOnly /></td>
                      <td className="font-mono text-xs">{o.number}</td>
                      <td><Money amount={o.amountCents} currency={o.currency} /></td>
                      <td><StatusBadge status={o.status} label={o.status === "COMPLETED" ? "paid" : undefined} /></td>
                      <td>{inv ? <Link href={`${base}/portal/invoices/${inv.id}`}>{inv.number}</Link> : "—"}</td>
                    </tr>
                  );
                })}
                {orders.length === 0 && <tr><td colSpan={5} className="muted">No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Need help?">
          <p className="text-sm">
            Contact {reseller.storeName}:{" "}
            {[reseller.contactEmail && <a key="e" href={`mailto:${reseller.contactEmail}`}>{reseller.contactEmail}</a>, reseller.contactTelegram && <span key="t">Telegram {reseller.contactTelegram}</span>, reseller.contactWhatsapp && <span key="w">WhatsApp {reseller.contactWhatsapp}</span>, reseller.contactPhone && <span key="p">{reseller.contactPhone}</span>]
              .filter(Boolean)
              .map((el, i) => <span key={i}>{i > 0 && " · "}{el}</span>)}
          </p>
        </Card>
      </div>
    </>
  );
}
