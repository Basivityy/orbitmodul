import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, Money, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderStatusLabel } from "@/lib/orders";
import { retryActivationAction } from "../actions/orders";
import { displayCustomer } from "@/core/importedCustomers";

export const metadata = { title: "Orders & activations" };
const PER = 50;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "completed", label: "Completed" },
  { key: "pending", label: "Awaiting payment" },
  { key: "failed", label: "Payment failed" },
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const status = sp.status ?? "all";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.OrderWhereInput = { resellerId: reseller.id };
  if (status === "attention") where.status = { in: ["ACTIVATION_FAILED", "ON_HOLD"] };
  if (status === "completed") where.status = "COMPLETED";
  if (status === "pending") where.status = "PENDING";
  if (status === "failed") where.status = "FAILED";
  const rows = await db.order.findMany({ where, include: { customer: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 });
  return (
    <>
      <PageHeader title="Orders & activations" description="Every payment, its activation status and any API errors. Failed activations can be retried safely — a paid order never creates a second line." />
      <Flash sp={sp} />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <Link key={f.key} href={`/dashboard/orders?status=${f.key}`} className={status === f.key ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{f.label}</Link>)}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No orders" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Amount</th><th>Gateway</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/dashboard/orders/${o.id}`} className="font-mono">{o.number}</Link><div className="muted text-xs">{o.kind === "RENEWAL" ? "renewal" : "new"}</div></td>
                    <td>{displayCustomer(o.customer.email)}</td>
                    <td><DateTime value={o.createdAt} /></td>
                    <td><Money amount={o.amountCents} currency={o.currency} /></td>
                    <td>{o.provider.toLowerCase()}</td>
                    <td><StatusBadge status={o.status} label={orderStatusLabel[o.status]} />{o.errorMessage && <div className="max-w-xs truncate text-xs text-rose-600" title={o.errorMessage}>{o.errorMessage}</div>}</td>
                    <td className="text-right">
                      {["ACTIVATION_FAILED", "ON_HOLD"].includes(o.status) && (
                        <form action={retryActivationAction}>
                          <input type="hidden" name="orderId" value={o.id} />
                          <input type="hidden" name="back" value={`/dashboard/orders?status=${status}`} />
                          <SubmitButton className="btn-secondary btn-sm">Retry</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/dashboard/orders?status=${status}`} />
      </Card>
    </>
  );
}
