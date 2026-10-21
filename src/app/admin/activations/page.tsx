import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminRetryActivationAction } from "../actions";

export const metadata = { title: "Failed activations" };

export default async function ActivationsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [orders, mp] = await Promise.all([
    db.order.findMany({ where: { status: { in: ["ACTIVATION_FAILED", "ON_HOLD"] } }, include: { reseller: true, customer: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.subscription.findMany({ where: { maxPlayerStatus: "FAILED" }, include: { reseller: true, customer: true }, orderBy: { updatedAt: "desc" }, take: 100 }),
  ]);
  return (
    <>
      <PageHeader title="Failed activations" description="Paid orders whose line could not be created yet. Retrying is safe — the engine never creates a second line for the same order." />
      <Flash sp={sp} />
      <Card title="Orders" pad={false}>
        {orders.length === 0 ? <Empty title="Nothing to fix 🎉" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order</th><th>Reseller</th><th>Customer</th><th>Amount</th><th>Status</th><th>Attempts</th><th>Error</th><th /></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs">{o.number}<div className="muted"><DateTime value={o.paidAt} /></div></td>
                    <td><Link href={`/admin/resellers/${o.resellerId}`}>{o.reseller.storeName}</Link></td>
                    <td>{o.customer.email}</td>
                    <td><Money amount={o.amountCents} currency={o.currency} /></td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>{o.attempts}</td>
                    <td className="max-w-sm whitespace-normal text-xs text-rose-600">{o.errorMessage}</td>
                    <td><form action={adminRetryActivationAction}><input type="hidden" name="orderId" value={o.id} /><SubmitButton className="btn-secondary btn-sm">Retry</SubmitButton></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="MaxPlayer failures" pad={false} className="mt-6">
        {mp.length === 0 ? <Empty title="No MaxPlayer failures" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Reseller</th><th>Customer</th><th>Line</th><th>Error</th><th>Updated</th></tr></thead>
              <tbody>{mp.map((s) => <tr key={s.id}><td>{s.reseller.storeName}</td><td>{s.customer.email}</td><td className="font-mono text-xs">{s.lineUsername}</td><td className="max-w-sm whitespace-normal text-xs text-rose-600">{s.maxPlayerError}</td><td><DateTime value={s.updatedAt} /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
