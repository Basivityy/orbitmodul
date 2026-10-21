import Link from "next/link";
import { notFound } from "next/navigation";
import type { PackageSnapshot } from "@/core/activation/engine";
import { getProvider } from "@/core/payments";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderStatusLabel } from "@/lib/orders";
import { refundOrderAction, retryActivationAction } from "../../actions/orders";
import { displayCustomer } from "@/core/importedCustomers";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await requireReseller();
  const o = await db.order.findFirst({ where: { id, resellerId: reseller.id }, include: { customer: true, subscription: true, transactions: true, invoice: true, coupon: true } });
  if (!o) notFound();
  const logs = await db.apiLog.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
  const snap = o.packageSnapshot as unknown as PackageSnapshot;
  const inFlight = ["PAID", "ACTIVATING"].includes(o.status);
  const back = `/dashboard/orders/${o.id}`;
  return (
    <>
      <AutoRefresh active={inFlight} />
      <PageHeader title={`Order ${o.number}`} description={<StatusBadge status={o.status} label={orderStatusLabel[o.status]} />} />
      <Flash sp={sp} />
      {o.errorMessage && <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{o.errorMessage}</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Summary" className="lg:col-span-2">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="muted">Customer</dt><dd><Link href={`/dashboard/customers/${o.customerId}`}>{displayCustomer(o.customer.email)}</Link></dd></div>
            <div><dt className="muted">Type</dt><dd>{o.kind === "RENEWAL" ? "Renewal" : "New subscription"}</dd></div>
            <div><dt className="muted">Package (as sold)</dt><dd>{snap.name} · {snap.durationDays} days · {snap.maxConnections} conn.</dd></div>
            <div><dt className="muted">Bouquets (panel IDs)</dt><dd>{snap.bouquetIds.join(", ")}</dd></div>
            <div><dt className="muted">Amount</dt><dd><Money amount={o.amountCents} currency={o.currency} />{o.discountCents > 0 && <span className="muted"> (discount <Money amount={o.discountCents} currency={o.currency} />{o.coupon ? ` · ${o.coupon.code}` : ""})</span>}</dd></div>
            <div><dt className="muted">Gateway</dt><dd>{o.provider.toLowerCase()} {o.providerPaymentId && <code className="text-xs">{o.providerPaymentId}</code>}</dd></div>
            <div><dt className="muted">Created</dt><dd><DateTime value={o.createdAt} /></dd></div>
            <div><dt className="muted">Paid</dt><dd><DateTime value={o.paidAt} /></dd></div>
            <div><dt className="muted">Activated</dt><dd><DateTime value={o.activatedAt} /></dd></div>
            <div><dt className="muted">Activation attempts</dt><dd>{o.attempts}</dd></div>
            <div><dt className="muted">Subscription</dt><dd>{o.subscriptionId ? <Link href={`/dashboard/subscriptions/${o.subscriptionId}`}>Open</Link> : "—"}</dd></div>
            <div><dt className="muted">Invoice</dt><dd>{o.invoice?.number ?? "—"}</dd></div>
          </dl>
        </Card>
        <Card title="Actions">
          <div className="space-y-3">
            {["ACTIVATION_FAILED", "ON_HOLD", "PAID", "ACTIVATING"].includes(o.status) && (
              <form action={retryActivationAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="back" value={back} />
                <SubmitButton className="btn-primary w-full">Retry activation</SubmitButton>
              </form>
            )}
            {o.providerPaymentId && o.amountCents > 0 && o.status !== "REFUNDED" && getProvider(o.provider).supportsRefunds && (
              <form action={refundOrderAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="back" value={back} />
                <SubmitButton className="btn-danger w-full" confirm="Refund the full amount to the customer?">Refund payment</SubmitButton>
              </form>
            )}
            {inFlight && <p className="muted text-center">Activation in progress — this page refreshes automatically.</p>}
          </div>
        </Card>
      </div>
      <Card title="Activation log" pad={false} className="mt-6">
        {logs.length === 0 ? <p className="muted p-5">No API calls recorded for this order yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Service</th><th>Action</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td><DateTime value={l.createdAt} /></td>
                    <td>{l.service}</td>
                    <td className="font-mono text-xs">{l.action}</td>
                    <td>{l.success ? <span className="badge-green">ok</span> : <span className="badge-red">error</span>} {l.durationMs != null && <span className="muted text-xs">{l.durationMs} ms</span>}</td>
                    <td className="max-w-md whitespace-normal text-xs">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
