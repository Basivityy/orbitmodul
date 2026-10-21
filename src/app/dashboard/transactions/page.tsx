import { Card, DateTime, Empty, Money, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Transactions" };
const PER = 100;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const rows = await db.transaction.findMany({ where: { resellerId: reseller.id }, include: { order: { include: { customer: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 });
  return (
    <>
      <PageHeader title="Transactions" description="Payments and refunds received through your gateways." actions={<a className="btn-secondary" href="/dashboard/transactions/export">Export CSV</a>} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No transactions yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Type</th><th>Gateway</th><th>Reference</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((t) => (
                  <tr key={t.id}>
                    <td><DateTime value={t.createdAt} /></td>
                    <td className="font-mono text-xs">{t.order?.number ?? "—"}</td>
                    <td>{t.order?.customer.email ?? "—"}</td>
                    <td><StatusBadge status={t.type === "REFUND" ? "REFUNDED" : t.status} label={t.type.toLowerCase()} /></td>
                    <td>{t.provider.toLowerCase()}</td>
                    <td className="font-mono text-xs">{t.providerRef}</td>
                    <td className="text-right"><Money amount={t.amountCents} currency={t.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref="/dashboard/transactions" />
      </Card>
    </>
  );
}
