import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { getLineSync } from "@/lib/lineSync";
import { Card, DateTime, Empty, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { baseWhere, extraWhere, filterQuery, kindWhere, lineOrderBy, lineWhere, parseLineFilter, statusWhere, SORTS, type Kind, type LineStatus } from "@/core/lineFilters";
import { deleteCustomerAction, refreshLinesAction } from "../actions/customers";

export const metadata = { title: "Customers" };
const PER = 50;

const KIND_LABEL: Record<Kind, string> = { line: "Lines", mag: "MAG", enigma: "Enigma", restreamer: "Restreamers", any: "Everything" };
const STATUS_LABEL: Record<LineStatus, { label: string; cls: string }> = {
  all: { label: "All", cls: "text-slate-950 dark:text-white" },
  active: { label: "Active", cls: "text-emerald-600 dark:text-emerald-400" },
  unlimited: { label: "No expiry", cls: "text-sky-600 dark:text-sky-400" },
  trial: { label: "Trial (test)", cls: "text-amber-600 dark:text-amber-400" },
  expiring: { label: "Expiring in 7 days", cls: "text-amber-600 dark:text-amber-400" },
  inactive: { label: "Inactive", cls: "text-rose-600 dark:text-rose-400" },
};
const SORT_LABEL: Record<(typeof SORTS)[number], string> = { expiry_desc: "Expiry: latest first", expiry_asc: "Expiry: soonest first", newest: "Newest in billing", username: "Username A–Z" };

/** One row per line, filterable by type (line / MAG / Enigma / restreamer), status, package, connections. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const f = parseLineFilter(sp);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();
  const W = (w: unknown) => w as Prisma.SubscriptionWhereInput;
  const base = baseWhere(reseller.id);
  const extra = extraWhere(f);
  const statuses = Object.keys(STATUS_LABEL) as LineStatus[];
  const [rows, kindCounts, statusCounts, packages, conns, sync] = await Promise.all([
    db.subscription.findMany({
      where: W(lineWhere(reseller.id, f, now)),
      orderBy: lineOrderBy(f.sort) as Prisma.SubscriptionOrderByWithRelationInput[],
      skip: (page - 1) * PER,
      take: PER + 1,
      include: { customer: { select: { id: true, email: true, name: true } }, package: { select: { name: true, maxConnections: true } } },
    }),
    db.subscription.groupBy({ by: ["panelKind"], where: W(base), _count: { _all: true } }),
    Promise.all(statuses.map((st) => db.subscription.count({ where: W({ AND: [base, kindWhere(f.kind), statusWhere(st, now), ...extra] }) }))),
    db.package.findMany({ where: { resellerId: reseller.id, subscriptions: { some: { isTest: false } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.subscription.groupBy({ by: ["maxConnections"], where: W(base), _count: { _all: true } }),
    getLineSync(reseller.id),
  ]);
  const kindN = (k: Kind) => (k === "any" ? kindCounts.reduce((a, r) => a + r._count._all, 0) : kindCounts.find((r) => r.panelKind === k)?._count._all ?? 0);
  const connOptions = [...new Set(conns.map((c) => c.maxConnections).filter((c): c is number => !!c))].sort((a, b) => a - b);
  const syncing = !!sync && (sync.status === "QUEUED" || sync.status === "RUNNING") && Date.now() - new Date(sync.at).getTime() < 2 * 3600_000;
  const isActive = (s: { status: string; expiresAt: Date | null }) => s.status === "ACTIVE" && (!s.expiresAt || s.expiresAt > now);
  const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const here = (change: Parameters<typeof filterQuery>[1]) => `/dashboard/customers${filterQuery(f, change)}`;
  return (
    <>
      <PageHeader title="Customers" description="Your lines and devices from the panel, with the customers they belong to." actions={<><a className="btn-secondary" href={`/dashboard/customers/export${filterQuery(f)}`}>⇩ CSV</a><Link className="btn-secondary" href="/dashboard/customers/existing">Load existing line</Link><Link className="btn-primary" href="/dashboard/customers/new">+ Add customer</Link></>} />

      {/* Type: like the panel's separate lists */}
      <div className="mb-3 flex flex-wrap gap-2">
        {(["line", "mag", "enigma", "restreamer", "any"] as Kind[]).filter((k) => k === "line" || k === "any" || kindN(k) > 0).map((k) => (
          <Link key={k} href={here({ kind: k })} className={f.kind === k ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>
            {KIND_LABEL[k]} <span className="ml-1 opacity-70">{kindN(k).toLocaleString()}</span>
          </Link>
        ))}
      </div>

      {/* Status counts (within the type, search, package and connections chosen) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statuses.map((st, i) => (
          <Link key={st} href={here({ status: st })} className={`card p-3 no-underline hover:no-underline ${f.status === st ? "ring-2 ring-brand-500" : ""}`}>
            <div className="muted text-xs font-semibold uppercase tracking-wide">{STATUS_LABEL[st].label}</div>
            <div className={`mt-1 text-2xl font-black tabular-nums ${STATUS_LABEL[st].cls}`}>{statusCounts[i].toLocaleString()}</div>
          </Link>
        ))}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/dashboard/customers">
        {f.kind !== "line" && <input type="hidden" name="kind" value={f.kind} />}
        {f.status !== "all" && <input type="hidden" name="status" value={f.status} />}
        <input className="input max-w-xs flex-1" name="q" defaultValue={f.q} placeholder="Username, email, name or note" />
        <select className="input w-auto" name="pkg" defaultValue={f.pkg} aria-label="Package">
          <option value="">All packages</option>
          {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto" name="conn" defaultValue={f.conn ? String(f.conn) : ""} aria-label="Connections">
          <option value="">Any connections</option>
          {connOptions.map((c) => <option key={c} value={c}>{c} connection{c === 1 ? "" : "s"}</option>)}
        </select>
        <select className="input w-auto" name="sort" defaultValue={f.sort} aria-label="Sort">
          {SORTS.map((o) => <option key={o} value={o}>{SORT_LABEL[o]}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
        {(f.q || f.pkg || f.conn || f.sort !== "expiry_desc") && <Link className="btn-ghost btn-sm" href={here({ q: "", pkg: "", conn: null, sort: "expiry_desc" })}>Clear</Link>}
      </form>

      <AutoRefresh active={syncing} intervalMs={5000} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
        <span>
          {syncing ? (
            <b>Refreshing from the panel… {sync!.checked}/{sync!.total || "?"}</b>
          ) : sync ? (
            <>Last refresh from the panel: <DateTime value={new Date(sync.at)} /> · {sync.updated} changed{sync.missing ? ` · ${sync.missing} not found on the panel` : ""}{sync.breakdown && Object.keys(sync.breakdown).length ? ` · panel says: ${Object.entries(sync.breakdown).map(([k, v]) => `${v} ${k}`).join(", ")}` : ""}{sync.status === "ERROR" ? <span className="text-rose-600"> · error: {sync.error}</span> : null}</>
          ) : (
            <>Lines renewed or changed directly on the panel are taken over once a day.</>
          )}
        </span>
        <form action={refreshLinesAction}><SubmitButton className="btn-secondary btn-sm">{syncing ? "Refreshing…" : "Refresh from panel"}</SubmitButton></form>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty title="Nothing matches these filters" />
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
                      <td>
                        <span className={on ? "badge-green" : "badge-red"}>{on ? "● Active" : "● Inactive"}</span>
                        {s.panelTrial && <span className="badge-amber ml-1">trial</span>}
                        {s.panelKind !== "line" && <span className="badge-gray ml-1">{s.panelKind === "mag" ? "MAG" : s.panelKind === "enigma" ? "Enigma" : s.panelKind}</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {s.expiresAt ? <DateTime value={s.expiresAt} dateOnly /> : <span className="text-sky-600 dark:text-sky-400">no expiry</span>}
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
        <Pagination page={page} hasMore={rows.length > PER} baseHref={here({})} />
      </Card>
    </>
  );
}
