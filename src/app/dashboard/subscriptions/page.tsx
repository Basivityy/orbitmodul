import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Card, DateTime, Empty, Money, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayCustomer } from "@/core/importedCustomers";

export const metadata = { title: "Subscriptions" };
const PER = 50;
const FILTERS = [
  { key: "active", label: "Active" },
  { key: "expiring", label: "Expiring in 7 days" },
  { key: "expired", label: "Expired" },
  { key: "maxplayer_failed", label: "MaxPlayer failed" },
  { key: "all", label: "All" },
];

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const filter = sp.filter ?? "active";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();
  const where: Prisma.SubscriptionWhereInput = { resellerId: reseller.id };
  if (filter === "active") where.status = "ACTIVE";
  if (filter === "expiring") Object.assign(where, { status: "ACTIVE", expiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86_400_000) } });
  if (filter === "expired") where.status = "EXPIRED";
  if (filter === "maxplayer_failed") where.maxPlayerStatus = "FAILED";
  if (q) where.OR = [{ lineUsername: { contains: q, mode: "insensitive" } }, { customer: { email: { contains: q, mode: "insensitive" } } }];
  const rows = await db.subscription.findMany({ where, include: { customer: true, package: true }, orderBy: filter === "expiring" ? { expiresAt: "asc" } : { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 });
  return (
    <>
      <PageHeader title="Subscriptions" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/dashboard/subscriptions?filter=${f.key}`} className={filter === f.key ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{f.label}</Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <input className="input" name="q" defaultValue={q} placeholder="Email or line username" />
        </form>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No subscriptions" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Package</th><th>Line</th><th>Status</th><th>Expires</th><th>Renewal</th><th>MaxPlayer</th></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/dashboard/subscriptions/${s.id}`} className="font-medium">{displayCustomer(s.customer.email, s.lineUsername)}</Link></td>
                    <td>{s.package.name}<div className="muted text-xs"><Money amount={s.priceCents} currency={s.currency} /></div></td>
                    <td className="font-mono text-xs">{s.lineUsername ?? "—"}</td>
                    <td><StatusBadge status={s.status} /> {s.isTest && <span className="badge-amber">test</span>}</td>
                    <td><DateTime value={s.expiresAt} /></td>
                    <td>{s.autoRenew ? <span className="badge-blue">auto</span> : <span className="muted">manual</span>}</td>
                    <td><StatusBadge status={s.maxPlayerStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/dashboard/subscriptions?filter=${filter}&q=${encodeURIComponent(q)}`} />
      </Card>
    </>
  );
}
