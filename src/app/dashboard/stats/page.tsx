import Link from "next/link";
import { formatMoney } from "@/core/money";
import { BarChart, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { insights } from "@/lib/resellerInsights";

export const metadata = { title: "Statistics" };
export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
const money = (r: Record<string, number>) => Object.entries(r).filter(([, v]) => v).map(([c, v]) => formatMoney(v, c)).join(" + ") || "—";

export default async function StatsPage() {
  const { reseller } = await requireReseller();
  const s = await insights(reseller.id);
  const cur = reseller.defaultCurrency;
  const thisM = s.months[11];
  const lastM = s.months[10];
  const delta = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% vs last month` : undefined);
  return (
    <>
      <PageHeader title="Statistics" description="New lines, renewals and revenue over the last 12 months. Test lines are not counted." />
      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active lines" value={s.active} />
        <Stat label="Renewal rate (90 days)" value={s.renewalRate === null ? "—" : `${s.renewalRate}%`} tone={s.renewalRate === null ? undefined : s.renewalRate >= 60 ? "green" : s.renewalRate >= 40 ? "amber" : "red"} hint={`${s.renewals90} renewed · ${s.churned90} expired without renewal`} />
        <Stat label="New lines this month" value={thisM.newLines} hint={delta(thisM.newLines, lastM.newLines)} />
        <Stat label="Revenue this month" value={money(thisM.revenue)} hint={`last month: ${money(lastM.revenue)}`} />
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Revenue per month (${cur})`}>
          <BarChart data={s.months.map((m) => ({ label: label(m.month), value: m.revenue[cur] ?? 0 }))} currency={cur} />
        </Card>
        <Card title="Lines per month">
          <BarChart data={s.months.map((m) => ({ label: label(m.month), value: m.newLines + m.renewals }))} />
          <p className="hint mt-2">New lines + renewals (including activation codes and lines you added).</p>
        </Card>
        <Card title="Month by month" pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Month</th><th>New</th><th>Renewed</th><th>Revenue</th></tr></thead>
              <tbody>
                {[...s.months].reverse().map((m) => (
                  <tr key={m.month}><td>{label(m.month)}</td><td className="tabular-nums">{m.newLines}</td><td className="tabular-nums">{m.renewals}</td><td className="tabular-nums">{money(m.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Packages (last 90 days)" pad={false}>
          {s.packages.length === 0 ? (
            <Empty title="No sales yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Package</th><th>Lines</th><th>Revenue</th></tr></thead>
                <tbody>{s.packages.map((p, i) => <tr key={i}><td>{p.name}</td><td className="tabular-nums">{p.orders}</td><td className="tabular-nums">{formatMoney(p.revenue, p.currency)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {s.churned90 > 0 && <p className="hint mt-4">{s.churned90} line(s) expired in the last 90 days without renewal — <Link href="/dashboard/expiring?tab=expired">see the recent ones and remind them</Link>.</p>}
    </>
  );
}
