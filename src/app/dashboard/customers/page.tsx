import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { getLineSync } from "@/lib/lineSync";
import { Card, DateTime, Empty, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { deleteCustomerAction, refreshLinesAction } from "../actions/customers";

export const metadata = { title: "Customers" };
const PER = 50;

/** One row per line: username, customer, status (green / red), expiry, connections, panel notes. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();
  // Active = status ACTIVE and not past the expiry date; everything else is inactive.
  const activeWhere: Prisma.SubscriptionWhereInput = { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const show = sp.show === "active" || sp.show === "inactive" ? sp.show : "all";
  const base: Prisma.SubscriptionWhereInput = { resellerId: reseller.id, isTest: false };
  const search: Prisma.SubscriptionWhereInput = q
    ? { OR: [{ lineUsername: { contains: q, mode: "insensitive" } }, { customer: { email: { contains: q, mode: "insensitive" } } }, { customer: { name: { contains: q, mode: "insensitive" } } }] }
    : {};
  const filter: Prisma.SubscriptionWhereInput = show === "active" ? activeWhere : show === "inactive" ? { NOT: activeWhere } : {};
  const [rows, totalLines, activeLines, sync] = await Promise.all([
    db.subscription.findMany({
      where: { AND: [base, search, filter] },
      orderBy: [{ expiresAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: (page - 1) * PER,
      take: PER + 1,
      include: { customer: { select: { id: true, email: true, name: true } }, package: { select: { name: true, maxConnections: true } } },
    }),
    db.subscription.count({ where: base }),
    db.subscription.count({ where: { AND: [base, activeWhere] } }),
    getLineSync(reseller.id),
  ]);
  const syncing = !!sync && (sync.status === "QUEUED" || sync.status === "RUNNING") && Date.now() - new Date(sync.at).getTime() < 2 * 3600_000;
  const isActive = (s: { status: string; expiresAt: Date | null }) => s.status === "ACTIVE" && (!s.expiresAt || s.expiresAt > now);
  const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const tab = (key: string, label: string, n: number, cls: string) => (
    <Link href={`/dashboard/customers?show=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`card flex-1 p-4 no-underline hover:no-underline ${show === key ? "ring-2 ring-brand-500" : ""}`}>
      <div className="muted text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${cls}`}>{n.toLocaleString()}</div>
    </Link>
  );
  return (
    <>
      <PageHeader title="Customers" description="Your lines and the customers they belong to." actions={<><Link className="btn-secondary" href="/dashboard/customers/existing">Load existing line</Link><Link className="btn-primary" href="/dashboard/customers/new">+ Add customer</Link></>} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        {tab("all", "All lines", totalLines, "text-slate-950 dark:text-white")}
        {tab("active", "Active", activeLines, "text-emerald-600 dark:text-emerald-400")}
        {tab("inactive", "Inactive", totalLines - activeLines, "text-rose-600 dark:text-rose-400")}
      </div>
      <AutoRefresh active={syncing} intervalMs={5000} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
        <span>
          {syncing ? (
            <b>Refreshing from the panel… {sync!.checked}/{sync!.total || "?"}</b>
          ) : sync ? (
            <>Last refresh from the panel: <DateTime value={new Date(sync.at)} /> · {sync.updated} changed{sync.missing ? ` · ${sync.missing} not found on the panel` : ""}{sync.status === "ERROR" ? <span className="text-rose-600"> · error: {sync.error}</span> : null}</>
          ) : (
            <>Lines renewed or changed directly on the panel are taken over once a day.</>
          )}
        </span>
        <form action={refreshLinesAction}><SubmitButton className="btn-secondary btn-sm">{syncing ? "Refreshing…" : "Refresh from panel"}</SubmitButton></form>
      </div>
      <form className="mb-4 flex gap-2">
        {show !== "all" && <input type="hidden" name="show" value={show} />}
        <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Search username, email or name" />
        <button className="btn-secondary">Search</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty title="No lines found" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th className="text-center">Conn.</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PER).map((s) => {
                  const on = isActive(s);
                  const noEmail = isPlaceholderEmail(s.customer.email);
                  const d = s.expiresAt ? days(s.expiresAt) : null;
                  return (
                    <tr key={s.id} className={on ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-rose-500"}>
                      <td className="whitespace-nowrap">
                        <Link href={`/dashboard/subscriptions/${s.id}`} className="font-mono font-semibold">{s.lineUsername ?? "—"}</Link>
                        <div className="muted text-xs">{s.package.name}</div>
                      </td>
                      <td className="min-w-40">
                        <Link href={`/dashboard/customers/${s.customer.id}`} className={noEmail ? "muted text-sm" : "text-sm"}>{noEmail ? "no email" : s.customer.email}</Link>
                        {s.customer.name && <div className="muted text-xs">{s.customer.name}</div>}
                      </td>
                      <td><span className={on ? "badge-green" : "badge-red"}>{on ? "● Active" : "● Inactive"}</span></td>
                      <td className="whitespace-nowrap">
                        <DateTime value={s.expiresAt} dateOnly />
                        {d !== null && <div className={`text-xs ${on ? (d <= 3 ? "text-amber-600" : "muted") : "text-rose-600 dark:text-rose-400"}`}>{d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : d === 0 ? "today" : `${-d} day${d === -1 ? "" : "s"} ago`}</div>}
                      </td>
                      <td className="text-center tabular-nums">{s.maxConnections ?? s.package.maxConnections}</td>
                      <td className="max-w-56">{s.panelNotes ? <span className="block truncate text-sm" title={s.panelNotes}>{s.panelNotes}</span> : <span className="muted">—</span>}</td>
                      <td className="text-right">
                        <form action={deleteCustomerAction}>
                          <input type="hidden" name="customerId" value={s.customer.id} />
                          <input type="hidden" name="removeRemote" value="on" />
                          <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm={`Delete ${s.lineUsername ?? "this customer"}? The line on the XUI panel and the MaxPlayer account are deleted too. This cannot be undone.`}>Delete</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/dashboard/customers?show=${show}&q=${encodeURIComponent(q)}`} />
      </Card>
    </>
  );
}
