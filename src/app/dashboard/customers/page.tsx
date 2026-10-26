import Link from "next/link";
import { SubmitButton } from "@/components/client";
import type { Prisma } from "@prisma/client";
import { Card, DateTime, Empty, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayCustomer } from "@/core/importedCustomers";
import { deleteCustomerAction } from "../actions/customers";

export const metadata = { title: "Customers" };
const PER = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();
  // Active = status ACTIVE and not past the expiry date; everything else counts as inactive.
  const activeSub: Prisma.SubscriptionWhereInput = { status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const show = sp.show === "active" || sp.show === "inactive" ? sp.show : "all";
  const where: Prisma.CustomerWhereInput = {
    resellerId: reseller.id,
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { subscriptions: { some: { lineUsername: { contains: q, mode: "insensitive" } } } }] } : {}),
    ...(show === "active" ? { subscriptions: { some: activeSub } } : show === "inactive" ? { AND: [{ subscriptions: { some: {} } }, { subscriptions: { none: activeSub } }] } : {}),
  };
  const lineBase: Prisma.SubscriptionWhereInput = { resellerId: reseller.id, isTest: false };
  const [rows, totalLines, activeLines] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER,
      take: PER + 1,
      include: { subscriptions: { where: { isTest: false }, orderBy: { expiresAt: "desc" }, select: { id: true, lineUsername: true, status: true, expiresAt: true, maxConnections: true, panelNotes: true, package: { select: { maxConnections: true } } } }, _count: { select: { orders: true } } },
    }),
    db.subscription.count({ where: lineBase }),
    db.subscription.count({ where: { ...lineBase, ...activeSub } }),
  ]);
  const isActive = (s: { status: string; expiresAt: Date | null }) => s.status === "ACTIVE" && (!s.expiresAt || s.expiresAt > now);
  const tab = (key: string, label: string, n: number, cls: string) => (
    <Link href={`/dashboard/customers?show=${key}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`card flex-1 p-4 no-underline hover:no-underline ${show === key ? "ring-2 ring-brand-500" : ""}`}>
      <div className="muted text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${cls}`}>{n.toLocaleString()}</div>
    </Link>
  );
  return (
    <>
      <PageHeader title="Customers" description="Only your own customers are listed here." actions={<><Link className="btn-secondary" href="/dashboard/customers/existing">Load existing line</Link><Link className="btn-primary" href="/dashboard/customers/new">+ Add customer</Link></>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        {tab("all", "All lines", totalLines, "text-slate-950 dark:text-white")}
        {tab("active", "Active", activeLines, "text-emerald-600 dark:text-emerald-400")}
        {tab("inactive", "Inactive", totalLines - activeLines, "text-rose-600 dark:text-rose-400")}
      </div>
      <form className="mb-4 flex gap-2">
        {show !== "all" && <input type="hidden" name="show" value={show} />}
        <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Search email, name or username" />
        <button className="btn-secondary">Search</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No customers found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Lines &amp; expiry</th><th>Orders</th><th>Since</th><th></th></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((c) => {
                  const anyActive = c.subscriptions.some(isActive);
                  return (
                    <tr key={c.id} className={c.subscriptions.length ? (anyActive ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-rose-500") : undefined}>
                      <td><Link href={`/dashboard/customers/${c.id}`} className="font-medium">{displayCustomer(c.email)}</Link>{c.name && <div className="muted text-xs">{c.name}</div>}</td>
                      <td>
                        {c.subscriptions.length === 0 ? (
                          <span className="muted">no line</span>
                        ) : (
                          <ul className="space-y-1">
                            {c.subscriptions.slice(0, 4).map((s) => {
                              const on = isActive(s);
                              return (
                                <li key={s.id} className="flex flex-wrap items-center gap-2">
                                  <Link href={`/dashboard/subscriptions/${s.id}`} className={`no-underline ${on ? "badge-green" : "badge-red"}`}>{on ? "● active" : "● inactive"}</Link>
                                  <span className="font-mono text-sm">{s.lineUsername ?? "—"}</span>
                                  <span className={`text-xs tabular-nums ${on ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    {s.expiresAt ? <>{on ? "expires" : "expired"} <DateTime value={s.expiresAt} dateOnly /></> : "no expiry"}
                                  </span>
                                  <span className="badge-gray" title="Connections">{s.maxConnections ?? s.package.maxConnections} conn.</span>
                                  {s.panelNotes && <span className="muted w-full truncate text-xs sm:w-auto sm:max-w-xs" title={s.panelNotes}>📝 {s.panelNotes}</span>}
                                </li>
                              );
                            })}
                            {c.subscriptions.length > 4 && <li className="muted text-xs">+{c.subscriptions.length - 4} more</li>}
                          </ul>
                        )}
                      </td>
                      <td>{c._count.orders}</td>
                      <td><DateTime value={c.createdAt} dateOnly /></td>
                      <td className="text-right">
                        <form action={deleteCustomerAction}>
                          <input type="hidden" name="customerId" value={c.id} />
                          <input type="hidden" name="removeRemote" value="on" />
                          <SubmitButton className="text-xs text-rose-600 hover:underline" confirm={`Delete ${displayCustomer(c.email)}? The customer's line on the XUI panel and the MaxPlayer account are deleted too. This cannot be undone.`}>Delete</SubmitButton>
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
