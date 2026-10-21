import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Card, DateTime, Empty, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { displayCustomer } from "@/core/importedCustomers";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { filterQuery, LINE_STATUSES, lineWhere, MP_FILTERS, parseLineFilters } from "@/core/adminLines";

export const metadata = { title: "All customers & lines" };
export const dynamic = "force-dynamic";
const PER = 50;

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = parseLineFilters(sp);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = lineWhere(f) as Prisma.SubscriptionWhereInput;
  const now = new Date();
  const [rows, total, byStatus, mpReal, resellers, expiring] = await Promise.all([
    db.subscription.findMany({
      where,
      include: { customer: true, package: { select: { name: true } }, panel: { select: { name: true } }, reseller: { select: { id: true, storeName: true, owner: { select: { email: true } } } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER,
      take: PER + 1,
    }),
    db.subscription.count({ where }),
    db.subscription.groupBy({ by: ["status"], where: { isTest: false }, _count: { _all: true } }),
    db.subscription.count({ where: { isTest: false, maxPlayerStatus: "ACTIVE", NOT: { maxPlayerUserId: { startsWith: "TEST-" } } } }),
    db.reseller.findMany({ select: { id: true, storeName: true, owner: { select: { email: true } } }, orderBy: { storeName: "asc" } }),
    db.subscription.count({ where: { isTest: false, status: "ACTIVE", expiresAt: { gt: now, lt: new Date(now.getTime() + 7 * 86_400_000) } } }),
  ]);
  const n = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const all = byStatus.reduce((a, b) => a + b._count._all, 0);
  const stats = [
    { label: "All lines", value: all, href: "/admin/customers" },
    { label: "Active", value: n("ACTIVE"), href: "/admin/customers?status=ACTIVE" },
    { label: "Expiring in 7 days", value: expiring, href: "/admin/customers?status=EXPIRING" },
    { label: "Expired", value: n("EXPIRED"), href: "/admin/customers?status=EXPIRED" },
    { label: "With MaxPlayer", value: mpReal, href: "/admin/customers?mp=ACTIVE" },
  ];
  const base = `/admin/customers${filterQuery(f)}`;
  const filtered = !!(f.q || f.reseller || f.status || f.mp || f.test !== "hide");

  return (
    <>
      <PageHeader
        title="All customers & lines"
        description="Every customer line on the platform, from all resellers — with its owner. Test-mode lines are hidden unless you choose to show them."
        actions={<a className="btn-secondary" href={`/admin/customers/export${filterQuery(f)}`}>Export CSV</a>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card card-pad no-underline hover:no-underline">
            <div className="muted text-xs">{s.label}</div>
            <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{s.value}</div>
          </Link>
        ))}
      </div>

      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <input className="input lg:col-span-2" name="q" defaultValue={f.q} placeholder="Line username, customer email, reseller…" />
        <select className="input" name="reseller" defaultValue={f.reseller}>
          <option value="">All resellers (owners)</option>
          {resellers.map((r) => (
            <option key={r.id} value={r.id}>{r.storeName} — {r.owner.email}</option>
          ))}
        </select>
        <select className="input" name="status" defaultValue={f.status}>
          <option value="">Any status</option>
          {LINE_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          <option value="EXPIRING">expiring in 7 days</option>
        </select>
        <select className="input" name="mp" defaultValue={f.mp}>
          <option value="">MaxPlayer: any</option>
          {MP_FILTERS.map((m) => <option key={m} value={m}>MaxPlayer: {m === "NONE" ? "none" : m.toLowerCase()}</option>)}
        </select>
        <div className="flex gap-2">
          <select className="input" name="test" defaultValue={f.test === "hide" ? "" : f.test === "only" ? "only" : "show"} aria-label="Test lines">
            <option value="">Real lines</option>
            <option value="show">Real + test</option>
            <option value="only">Only test</option>
          </select>
          <button className="btn-primary">Filter</button>
        </div>
      </form>
      {filtered && <p className="mb-3 text-sm"><b>{total}</b> line(s) match · <Link href="/admin/customers">Clear filters</Link></p>}

      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No lines found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Line / customer</th><th>Owner (reseller)</th><th>Package · panel</th><th>Status</th><th>Expires</th><th>MaxPlayer</th><th>Created</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, PER).map((s) => {
                  const simulated = (s.maxPlayerUserId ?? "").startsWith("TEST-");
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/admin/customers/${s.id}`} className="font-mono font-medium">{s.lineUsername ?? "—"}</Link>
                        {s.isTest && <span className="badge-amber ml-2">test</span>}
                        <div className="muted text-xs">{displayCustomer(s.customer.email, s.lineUsername)}{s.customer.name ? ` · ${s.customer.name}` : ""}</div>
                      </td>
                      <td>
                        <Link href={`/admin/resellers/${s.reseller.id}`}>{s.reseller.storeName}</Link>
                        <div className="muted text-xs">{s.reseller.owner.email}</div>
                      </td>
                      <td className="text-sm">{s.package.name}<div className="muted text-xs">{s.panel.name}</div></td>
                      <td><StatusBadge status={s.status} /></td>
                      <td><DateTime value={s.expiresAt} /></td>
                      <td className="text-xs">
                        <StatusBadge status={simulated ? "TEST" : s.maxPlayerStatus} label={simulated ? "simulated" : s.maxPlayerStatus === "NONE" ? "—" : undefined} />
                        {s.maxPlayerUserId && !simulated && <div className="muted font-mono">#{s.maxPlayerUserId}</div>}
                      </td>
                      <td><DateTime value={s.createdAt} dateOnly /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={base} />
      </Card>
    </>
  );
}
