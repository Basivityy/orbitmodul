import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { deleteCustomerAction } from "../../actions/customers";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderStatusLabel } from "@/lib/orders";
import { displayCustomer } from "@/core/importedCustomers";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await requireReseller();
  const c = await db.customer.findFirst({
    where: { id, resellerId: reseller.id },
    include: { subscriptions: { include: { package: true }, orderBy: { createdAt: "desc" } }, orders: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!c) notFound();
  return (
    <>
      <PageHeader title={displayCustomer(c.email, c.subscriptions[0]?.lineUsername)} description={c.name ?? undefined} actions={<a className="btn-secondary" href="#delete">Delete customer</a>} />
      <Flash sp={sp} />
      <div className="grid gap-6">
        <Card title="Subscriptions" pad={false}>
          {c.subscriptions.length === 0 ? <Empty title="No subscriptions" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Package</th><th>Line</th><th>Status</th><th>Expires</th><th>Price</th></tr></thead>
                <tbody>
                  {c.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/dashboard/subscriptions/${s.id}`}>{s.package.name}</Link></td>
                      <td className="font-mono text-xs">{s.lineUsername ?? "—"}</td>
                      <td><StatusBadge status={s.status} /> {s.isTest && <span className="badge-amber">test</span>}</td>
                      <td><DateTime value={s.expiresAt} /></td>
                      <td><Money amount={s.priceCents} currency={s.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Orders" pad={false}>
          {c.orders.length === 0 ? <Empty title="No orders" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Order</th><th>Date</th><th>Amount</th><th>Gateway</th><th>Status</th></tr></thead>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/dashboard/orders/${o.id}`} className="font-mono">{o.number}</Link></td>
                      <td><DateTime value={o.createdAt} /></td>
                      <td><Money amount={o.amountCents} currency={o.currency} /></td>
                      <td>{o.provider.toLowerCase()}</td>
                      <td><StatusBadge status={o.status} label={orderStatusLabel[o.status]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div id="delete">
          <Card title="Delete customer" description="Permanently removes this customer, their subscriptions, orders and invoices from your billing. Revenue totals in your reports are kept.">
            <form action={deleteCustomerAction} className="space-y-4">
              <input type="hidden" name="customerId" value={c.id} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="removeRemote" defaultChecked className="mt-1" />
                <span><b>Also delete on XUI panel and MaxPlayer</b><br /><span className="muted">The customer's line{c.subscriptions.length === 1 ? "" : "s"} ({c.subscriptions.map((s) => s.lineUsername).filter(Boolean).join(", ") || "none"}) and MaxPlayer account are deleted, so the customer can no longer watch. Untick to remove the customer from billing only.</span></span>
              </label>
              <SubmitButton className="btn-danger" confirm={`Delete ${displayCustomer(c.email, c.subscriptions[0]?.lineUsername)}? This cannot be undone.`}>Delete customer</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
