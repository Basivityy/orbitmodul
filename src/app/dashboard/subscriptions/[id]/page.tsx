import Link from "next/link";
import { notFound } from "next/navigation";
import { decrypt } from "@/core/crypto";
import { CopyButton, Secret, SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderStatusLabel } from "@/lib/orders";
import { cancelAutoRenewAction, extendSubscriptionAction, resendCredentialsAction, setLineStateAction, syncLineAction } from "../../actions/orders";
import { issueAppCodeAction, resetAppDevicesAction } from "../../actions/app";
import { retryMaxPlayerAction } from "../../actions/integrations";
import { displayCustomer } from "@/core/importedCustomers";

export const metadata = { title: "Subscription" };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <dt className="muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

export default async function SubscriptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await requireReseller();
  const s = await db.subscription.findFirst({ where: { id, resellerId: reseller.id }, include: { customer: true, package: true, panel: true, orders: { orderBy: { createdAt: "desc" } } } });
  if (!s) notFound();
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const resellerApi = /reseller/i.test(s.panel.apiUrl);
  const [extendPackages, devices] = await Promise.all([
    db.package.findMany({ where: { resellerId: reseller.id, panelId: s.panelId, externalPackageId: { not: null } }, orderBy: [{ sortOrder: "asc" }, { durationDays: "asc" }] }),
    db.appDevice.findMany({ where: { subscriptionId: s.id }, orderBy: { lastSeenAt: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title={`${s.package.name} · ${displayCustomer(s.customer.email, s.lineUsername)}`} description={<span className="flex gap-2"><StatusBadge status={s.status} />{s.isTest && <span className="badge-amber">test line</span>}</span>} />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl>
            <Row k="Customer" v={<Link href={`/dashboard/customers/${s.customerId}`}>{displayCustomer(s.customer.email, s.lineUsername)}</Link>} />
            <Row k="Username" v={<code>{s.lineUsername ?? "—"}</code>} />
            <Row k="Password" v={s.linePasswordEnc ? <Secret value={decrypt(s.linePasswordEnc)} /> : "—"} />
            <Row k="XUI line ID" v={s.xuiLineId ?? "—"} />
            <Row k="Panel" v={s.panel.name} />
            <Row k="Started" v={<DateTime value={s.startsAt} />} />
            <Row k="Expires" v={<DateTime value={s.expiresAt} />} />
            <Row k="Connections" v={String(s.maxConnections ?? s.package.maxConnections)} />
            {s.panelNotes && <Row k="Notes (panel)" v={<span className="whitespace-pre-line">{s.panelNotes}</span>} />}
            <Row k="Contracted price" v={<><Money amount={s.priceCents} currency={s.currency} /> / {s.durationDays} days</>} />
            <Row k="Renewal" v={s.autoRenew ? `Automatic (${s.provider?.toLowerCase()})` : "Manual"} />
            <Row k="MaxPlayer" v={<span>{s.maxPlayerUserId?.startsWith("TEST-") ? <span className="badge-amber">simulated (test mode) — no real account</span> : <StatusBadge status={s.maxPlayerStatus} label={s.maxPlayerStatus === "NONE" ? "no account" : undefined} />} {s.maxPlayerUserId && !s.maxPlayerUserId.startsWith("TEST-") && <span className="muted">#{s.maxPlayerUserId}</span>}{s.maxPlayerError && <span className="block text-xs text-rose-600">{s.maxPlayerError}</span>}</span>} />
          </dl>
        </Card>
        <div className="space-y-6">
          <Card title="App login">
            {s.appCode ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="muted">App code</span><code className="select-all font-mono">{s.appCode}</code><CopyButton text={s.appCode} /></div>
                <div className="muted">Devices: {devices.length} / {Math.max(1, s.package.maxConnections)}</div>
                {devices.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {devices.map((d) => <li key={d.id} className="flex justify-between gap-2"><span>{d.name ?? d.deviceId.slice(0, 18)}</span><span className="muted"><DateTime value={d.lastSeenAt} /></span></li>)}
                  </ul>
                )}
                {devices.length > 0 && (
                  <form action={resetAppDevicesAction}>{hidden("subscriptionId", s.id)}<SubmitButton className="btn-secondary w-full" confirm="Sign out all devices? The customer signs in again with the code.">Reset devices</SubmitButton></form>
                )}
              </div>
            ) : (
              <form action={issueAppCodeAction} className="space-y-2">
                {hidden("subscriptionId", s.id)}
                <p className="muted text-sm">This line has no app code yet. Create one and give it to the customer — they sign in to the app with it, without username and password.</p>
                <SubmitButton className="btn-secondary w-full">Create app code</SubmitButton>
              </form>
            )}
          </Card>
          <Card title="Actions">
            <div className="space-y-3">
              <form action={extendSubscriptionAction} className="space-y-2">
                {hidden("subscriptionId", s.id)}
                <div className="flex gap-2">
                  {resellerApi ? (
                    <select className="input flex-1" name="packageId" defaultValue={extendPackages.find((p) => p.id === s.packageId)?.id ?? extendPackages[0]?.id ?? ""} aria-label="Package">
                      {extendPackages.length === 0 && <option value="">No package linked to the panel</option>}
                      {extendPackages.map((p) => <option key={p.id} value={p.id}>{p.name} (+{p.durationDays} days)</option>)}
                    </select>
                  ) : (
                    <input className="input w-24" name="days" type="number" min={1} defaultValue={s.durationDays} aria-label="Days" />
                  )}
                  <input className="input flex-1" name="amount" inputMode="decimal" placeholder={`Paid ${s.currency} (empty = free)`} aria-label="Amount received" />
                </div>
                <SubmitButton className="btn-secondary w-full">Extend line (XUI + MaxPlayer)</SubmitButton>
              </form>
              <form action={setLineStateAction} className="flex gap-2">
                {hidden("subscriptionId", s.id)}
                <SubmitButton className="btn-secondary flex-1" name="op" value="enable">Enable line</SubmitButton>
                <SubmitButton className="btn-secondary flex-1" name="op" value="disable" confirm="Disable this line on the panel?">Disable line</SubmitButton>
              </form>
              <form action={syncLineAction}>{hidden("subscriptionId", s.id)}<SubmitButton className="btn-secondary w-full">Check status on panel</SubmitButton></form>
              <form action={resendCredentialsAction}>{hidden("subscriptionId", s.id)}<SubmitButton className="btn-secondary w-full">Email access details</SubmitButton></form>
              {!s.isTest && s.lineUsername && (s.maxPlayerStatus !== "ACTIVE" || s.maxPlayerUserId?.startsWith("TEST-")) && (
                <form action={retryMaxPlayerAction}>
                  {hidden("subscriptionId", s.id)}
                  {hidden("back", `/dashboard/subscriptions/${s.id}`)}
                  <SubmitButton className="btn-secondary w-full">{s.maxPlayerStatus === "NONE" ? "Create MaxPlayer account" : s.maxPlayerUserId?.startsWith("TEST-") ? "Create real MaxPlayer account" : "Retry MaxPlayer"}</SubmitButton>
                </form>
              )}
              {s.autoRenew && (
                <form action={cancelAutoRenewAction}>{hidden("subscriptionId", s.id)}<SubmitButton className="btn-danger w-full" confirm="Cancel automatic renewal?">Cancel auto-renewal</SubmitButton></form>
              )}
            </div>
          </Card>
        </div>
      </div>
      <Card title="Orders for this subscription" pad={false} className="mt-6">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Type</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {s.orders.map((o) => (
                <tr key={o.id}>
                  <td><Link className="font-mono" href={`/dashboard/orders/${o.id}`}>{o.number}</Link></td>
                  <td>{o.kind.toLowerCase()}</td>
                  <td><DateTime value={o.createdAt} /></td>
                  <td><Money amount={o.amountCents} currency={o.currency} /></td>
                  <td><StatusBadge status={o.status} label={orderStatusLabel[o.status]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
