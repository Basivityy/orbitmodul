import Link from "next/link";
import { formatMoney } from "@/core/money";
import { BarChart, Card, DateTime, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { resellerPlansEnabled } from "@/lib/settings";
import { dailyRevenue, platformStats } from "@/lib/stats";

export const metadata = { title: "Platform overview" };

export default async function AdminHome() {
  await requireAdmin();
  const s = await platformStats();
  const mainCurrency = s.gmv30[0]?.currency ?? "EUR";
  const [chart, latestResellers, errors, plansOn, pending] = await Promise.all([
    dailyRevenue(mainCurrency, 30),
    db.reseller.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { saas: { include: { plan: true } } } }),
    db.apiLog.findMany({ where: { success: false }, orderBy: { createdAt: "desc" }, take: 6 }),
    resellerPlansEnabled(),
    db.reseller.count({ where: { approvalStatus: "PENDING" } }),
  ]);
  return (
    <>
      <PageHeader title="Platform overview" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Resellers" value={s.resellers} hint={plansOn ? `${s.suspended} suspended · ${s.trialing} on trial` : `${s.suspended} suspended`} />
        {plansOn ? (
          <Stat label="Paying resellers" value={s.payingResellers} hint={s.mrr.map((m) => `${formatMoney(m.amount, m.currency)} MRR`).join(" · ") || "No MRR yet"} tone="green" />
        ) : (
          <Stat label="Waiting for approval" value={<Link href="/admin/resellers?approval=PENDING">{pending}</Link>} hint="New resellers to approve" tone={pending ? "amber" : "green"} />
        )}
        <Stat label="Active subscriptions (all stores)" value={s.activeSubs} />
        <Stat label="Sales volume (30d)" value={s.gmv30.length ? <span className="flex flex-col text-xl">{s.gmv30.slice(0, 3).map((g) => <span key={g.currency}>{formatMoney(g.amount, g.currency)}</span>)}</span> : formatMoney(0, "EUR")} hint="Processed by resellers' own gateways" />
        <Stat label="Failed / held activations" value={<Link href="/admin/activations">{s.failedActivations}</Link>} tone={s.failedActivations ? "red" : "green"} />
        <Stat label="API errors (24h)" value={<Link href="/admin/logs">{s.apiErrors24h}</Link>} tone={s.apiErrors24h ? "amber" : "green"} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title={`Platform sales volume — 30 days (${mainCurrency})`} className="lg:col-span-2"><BarChart data={chart} currency={mainCurrency} /></Card>
        <Card title="Newest resellers" pad={false}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {latestResellers.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <Link href={`/admin/resellers/${r.id}`}>{r.storeName}</Link>
                {plansOn ? (
                  <span className="muted">{r.saas?.plan.name ?? "—"} · {r.saas?.status.toLowerCase() ?? "no plan"}</span>
                ) : (
                  <StatusBadge status={r.approvalStatus} label={r.approvalStatus === "PENDING" ? "waiting" : r.approvalStatus === "REJECTED" ? "declined" : "approved"} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Latest system errors" pad={false} className="mt-6">
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}><td><DateTime value={e.createdAt} /></td><td>{e.service}</td><td className="font-mono text-xs">{e.action}</td><td className="max-w-lg whitespace-normal text-xs">{e.message}</td></tr>
              ))}
              {errors.length === 0 && <tr><td className="muted">No errors.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
