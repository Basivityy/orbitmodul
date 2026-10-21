import Link from "next/link";
import { Card, DateTime, Money, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Transactions" };
const PER = 100;

export default async function AdminTransactions({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab === "saas" ? "saas" : "stores";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  return (
    <>
      <PageHeader title="Transactions" description="Store transactions are processed by each reseller's own gateway. SaaS invoices are what resellers paid you." />
      <div className="mb-4 flex gap-2">
        <Link href="/admin/transactions?tab=stores" className={tab === "stores" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>Store transactions</Link>
        <Link href="/admin/transactions?tab=saas" className={tab === "saas" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>SaaS invoices</Link>
      </div>
      {tab === "stores" ? <StoreTx page={page} /> : <SaasTx page={page} />}
    </>
  );
}

async function StoreTx({ page }: { page: number }) {
  const rows = await db.transaction.findMany({ include: { reseller: true, order: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 });
  return (
    <Card pad={false}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Date</th><th>Reseller</th><th>Order</th><th>Type</th><th>Gateway</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.slice(0, PER).map((t) => (
              <tr key={t.id}><td><DateTime value={t.createdAt} /></td><td><Link href={`/admin/resellers/${t.resellerId}`}>{t.reseller.storeName}</Link></td><td className="font-mono text-xs">{t.order?.number}</td><td><StatusBadge status={t.type === "REFUND" ? "REFUNDED" : t.status} label={t.type.toLowerCase()} /></td><td>{t.provider.toLowerCase()}</td><td className="text-right"><Money amount={t.amountCents} currency={t.currency} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} hasMore={rows.length > PER} baseHref="/admin/transactions?tab=stores" />
    </Card>
  );
}

async function SaasTx({ page }: { page: number }) {
  const rows = await db.saasInvoice.findMany({ include: { reseller: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 });
  return (
    <Card pad={false}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Date</th><th>Reseller</th><th>Invoice</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.slice(0, PER).map((i) => (
              <tr key={i.id}><td><DateTime value={i.paidAt ?? i.createdAt} /></td><td>{i.reseller.storeName}</td><td className="font-mono text-xs">{i.number}</td><td>{i.status.toLowerCase()}</td><td className="text-right"><Money amount={i.amountCents} currency={i.currency} /></td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No SaaS invoices yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} hasMore={rows.length > PER} baseHref="/admin/transactions?tab=saas" />
    </Card>
  );
}
