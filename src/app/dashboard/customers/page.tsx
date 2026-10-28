import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoRefresh, CopyButton, SubmitButton } from "@/components/client";
import { getLineSync } from "@/lib/lineSync";
import { Card, DateTime, Empty, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/core/crypto";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { baseWhere, extraWhere, filterQuery, kindWhere, lineOrderBy, lineWhere, parseLineFilter, statusWhere, SORTS, type Kind, type LineStatus } from "@/core/lineFilters";
import { deleteCustomerAction, refreshLinesAction } from "../actions/customers";

export const metadata = { title: "Customers" };
const PER = 50;

/** The groups, like the panel's own lists. "any" is not a group (only reachable by link). */
const GROUPS: Array<{ kind: Exclude<Kind, "any">; title: string; icon: string; hint: string }> = [
  { kind: "line", title: "Lines", icon: "☰", hint: "M3U / Xtream lines used in apps" },
  { kind: "mag", title: "MAG devices", icon: "▣", hint: "MAG / Stalker set-top boxes" },
  { kind: "enigma", title: "Enigma devices", icon: "◈", hint: "Enigma2 receivers" },
  { kind: "restreamer", title: "Restreamers", icon: "⇉", hint: "Restream lines" },
];
const STATUS_LABEL: Record<LineStatus, { label: string; dot: string }> = {
  all: { label: "All", dot: "bg-slate-400" },
  active: { label: "Active", dot: "bg-emerald-500" },
  unlimited: { label: "No expiry", dot: "bg-sky-500" },
  trial: { label: "Trial", dot: "bg-amber-500" },
  expiring: { label: "Expiring ≤ 7 days", dot: "bg-amber-500" },
  inactive: { label: "Inactive", dot: "bg-rose-500" },
};
const SORT_LABEL: Record<(typeof SORTS)[number], string> = { expiry_desc: "Expiry: latest first", expiry_asc: "Expiry: soonest first", newest: "Newest in billing", username: "Username A–Z" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const parsed = parseLineFilter(sp);
  // Always one group at a time (lines by default).
  const f = { ...parsed, kind: parsed.kind === "any" ? "line" : parsed.kind } as typeof parsed;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();
  const W = (w: unknown) => w as Prisma.SubscriptionWhereInput;
  const base = baseWhere(reseller.id);
  const extra = extraWhere(f);
  const statuses = Object.keys(STATUS_LABEL) as LineStatus[];
  const [rows, kindCounts, kindActive, statusCounts, packages, conns, sync] = await Promise.all([
    db.subscription.findMany({
      where: W(lineWhere(reseller.id, f, now)),
      orderBy: lineOrderBy(f.sort) as Prisma.SubscriptionOrderByWithRelationInput[],
      skip: (page - 1) * PER,
      take: PER + 1,
      include: { customer: { select: { id: true, email: true, name: true } }, package: { select: { name: true, maxConnections: true } } },
    }),
    db.subscription.groupBy({ by: ["panelKind"], where: W(base), _count: { _all: true } }),
    db.subscription.groupBy({ by: ["panelKind"], where: W({ AND: [base, statusWhere("active", now)] }), _count: { _all: true } }),
    Promise.all(statuses.map((st) => db.subscription.count({ where: W({ AND: [base, kindWhere(f.kind), statusWhere(st, now), ...extra] }) }))),
    db.package.findMany({ where: { resellerId: reseller.id, subscriptions: { some: { isTest: false } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.subscription.groupBy({ by: ["maxConnections"], where: W(base), _count: { _all: true } }),
    getLineSync(reseller.id),
  ]);
  const count = (list: typeof kindCounts, k: string) => list.find((r) => r.panelKind === k)?._count._all ?? 0;
  const groups = GROUPS.filter((g) => g.kind === "line" || g.kind === f.kind || count(kindCounts, g.kind) > 0);
  const group = GROUPS.find((g) => g.kind === f.kind)!;
  const connOptions = [...new Set(conns.map((c) => c.maxConnections).filter((c): c is number => !!c))].sort((a, b) => a - b);
  const syncing = !!sync && (sync.status === "QUEUED" || sync.status === "RUNNING") && Date.now() - new Date(sync.at).getTime() < 2 * 3600_000;
  const isActive = (s: { status: string; expiresAt: Date | null }) => s.status === "ACTIVE" && (!s.expiresAt || s.expiresAt > now);
  const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  const here = (change: Parameters<typeof filterQuery>[1]) => `/dashboard/customers${filterQuery(f, change)}`;
  const filtered = !!(f.q || f.pkg || f.conn || f.sort !== "expiry_desc");
  const isDevice = f.kind !== "line";

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everything you have on the panel, grouped like the panel: lines and devices, with login details."
        actions={
          <>
            <a className="btn-secondary" href={`/dashboard/customers/export${filterQuery(f)}`}>⇩ CSV</a>
            <Link className="btn-secondary" href="/dashboard/customers/existing">Load existing line</Link>
            <Link className="btn-primary" href="/dashboard/customers/new">+ Add customer</Link>
          </>
        }
      />

      {/* ── Groups ─────────────────────────────────────────────────────────── */}
      <div className={`mb-5 grid gap-3 ${groups.length > 2 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
        {groups.map((g) => {
          const on = g.kind === f.kind;
          return (
            <Link key={g.kind} href={here({ kind: g.kind, status: "all" })} className={`card flex items-center gap-4 p-4 no-underline hover:no-underline ${on ? "ring-2 ring-brand-500" : "opacity-80 hover:opacity-100"}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-xl font-black ${on ? "bg-brand-500 text-black" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`} aria-hidden>{g.icon}</span>
              <span className="min-w-0">
                <span className="block font-bold text-slate-950 dark:text-white">{g.title}</span>
                <span className="block text-sm tabular-nums">
                  <b>{count(kindCounts, g.kind).toLocaleString()}</b> total · <span className="text-emerald-600 dark:text-emerald-400">{count(kindActive, g.kind).toLocaleString()} active</span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <Card pad={false}>
        {/* ── Header of the group: status pills + filters ────────────────────── */}
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">{group.title}</h2>
            <span className="muted text-xs">{group.hint}</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {statuses.map((st, i) => (
              <Link key={st} href={here({ status: st })} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm no-underline hover:no-underline ${f.status === st ? "border-brand-500 bg-brand-500 font-semibold text-black" : "border-slate-200 text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"}`}>
                <span className={`h-2 w-2 rounded-full ${STATUS_LABEL[st].dot}`} aria-hidden />
                {STATUS_LABEL[st].label}
                <span className="tabular-nums opacity-70">{statusCounts[i].toLocaleString()}</span>
              </Link>
            ))}
          </div>
          <form className="flex flex-wrap items-center gap-2" action="/dashboard/customers">
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
            {filtered && <Link className="btn-ghost btn-sm" href={here({ q: "", pkg: "", conn: null, sort: "expiry_desc" })}>Clear</Link>}
          </form>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        {rows.length === 0 ? (
          <Empty title="Nothing here">{filtered || f.status !== "all" ? "No line matches these filters." : `No ${group.title.toLowerCase()} in your billing yet.`}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Password</th>
                  <th>Status</th>
                  <th>Expires</th>
                  {!isDevice && <th className="text-center">Conn.</th>}
                  <th>Package</th>
                  <th>Customer</th>
                  <th>Notes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, PER).map((s) => {
                  const on = isActive(s);
                  const noEmail = isPlaceholderEmail(s.customer.email);
                  const d = s.expiresAt ? days(s.expiresAt) : null;
                  const password = s.linePasswordEnc ? decrypt(s.linePasswordEnc) : null;
                  return (
                    <tr key={s.id} className={on ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-rose-500"}>
                      <td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Link href={`/dashboard/subscriptions/${s.id}`} className="font-mono font-semibold">{s.lineUsername ?? "—"}</Link>
                          {s.lineUsername && <CopyButton text={s.lineUsername} label="⧉" compact />}
                        </span>
                      </td>
                      <td className="whitespace-nowrap">
                        {password ? (
                          <span className="inline-flex items-center gap-1">
                            <code className="select-all text-sm">{password}</code>
                            <CopyButton text={password} label="⧉" compact />
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={on ? "badge-green" : "badge-red"}>{on ? "Active" : "Inactive"}</span>
                        {s.panelTrial && <span className="badge-amber ml-1">trial</span>}
                      </td>
                      <td className="whitespace-nowrap">
                        {s.expiresAt ? <DateTime value={s.expiresAt} dateOnly /> : <span className="text-sky-600 dark:text-sky-400">no expiry</span>}
                        {d !== null && <div className={`text-xs ${on ? (d <= 3 ? "text-amber-600" : "muted") : "text-rose-600 dark:text-rose-400"}`}>{d > 0 ? `in ${d} day${d === 1 ? "" : "s"}` : d === 0 ? "today" : `${-d} day${d === -1 ? "" : "s"} ago`}</div>}
                      </td>
                      {!isDevice && <td className="text-center tabular-nums">{s.maxConnections ?? s.package.maxConnections}</td>}
                      <td className="max-w-40 truncate text-sm" title={s.package.name}>{s.package.name}</td>
                      <td className="max-w-48">
                        <Link href={`/dashboard/customers/${s.customer.id}`} className={`block truncate text-sm ${noEmail ? "muted" : ""}`}>{noEmail ? "no email" : s.customer.email}</Link>
                        {s.customer.name && <div className="muted truncate text-xs">{s.customer.name}</div>}
                      </td>
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

      {/* ── Refresh from the panel ─────────────────────────────────────────── */}
      <AutoRefresh active={syncing} intervalMs={5000} />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
        <span className="muted">
          {syncing ? (
            <b className="text-slate-950 dark:text-white">Refreshing from the panel… {sync!.checked}/{sync!.total || "?"}</b>
          ) : sync ? (
            <>Last refresh from the panel: <DateTime value={new Date(sync.at)} /> · {sync.updated} changed{sync.missing ? ` · ${sync.missing} not found on the panel` : ""}{sync.status === "ERROR" ? <span className="text-rose-600"> · error: {sync.error}</span> : null}</>
          ) : (
            <>Lines renewed or changed directly on the panel are taken over once a day.</>
          )}
        </span>
        <form action={refreshLinesAction}><SubmitButton className="btn-secondary btn-sm">{syncing ? "Refreshing…" : "Refresh from panel"}</SubmitButton></form>
      </div>
    </>
  );
}
