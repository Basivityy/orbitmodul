import Link from "next/link";
import { formatMoney } from "@/core/money";
import { BarChart, Card, DateTime, Empty, Flash, Money, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { dailyRevenue, resellerStats, CurrencyTotal } from "@/lib/stats";
import { storeBaseUrl } from "@/lib/urls";
import { displayCustomer } from "@/core/importedCustomers";
import { SubmitButton } from "@/components/client";
import { HealthItem, type HealthTone } from "@/components/Health";
import { effectiveTestMode } from "@/lib/activationStore";
import { env } from "@/lib/env";
import { storeTestPaymentsEnabled } from "@/lib/settings";
import { retryAllMaxPlayerAction } from "./actions/integrations";

export const metadata = { title: "Overview" };

function Totals({ rows, fallback }: { rows: CurrencyTotal[]; fallback: string }) {
  if (!rows.length) return <>{formatMoney(0, fallback)}</>;
  return (
    <span className="flex flex-col">
      {rows.slice(0, 3).map((r) => (
        <span key={r.currency}>{formatMoney(r.amount, r.currency)}</span>
      ))}
    </span>
  );
}

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { user, reseller } = await requireReseller();
  const [s, chart, recent, setup] = await Promise.all([
    resellerStats(reseller.id),
    dailyRevenue(reseller.defaultCurrency, 30, reseller.id),
    db.transaction.findMany({ where: { resellerId: reseller.id }, orderBy: { createdAt: "desc" }, take: 8, include: { order: { include: { customer: true } } } }),
    Promise.all([
      db.panelIntegration.count({ where: { resellerId: reseller.id, status: "CONNECTED" } }),
      db.bouquet.count({ where: { resellerId: reseller.id } }),
      db.package.count({ where: { resellerId: reseller.id, active: true } }),
      db.paymentGateway.count({ where: { resellerId: reseller.id, enabled: true, NOT: { provider: "TEST" } } }),
    ]),
  ]);
  const [panels, bouquets, packages, gateways] = setup;
  const [panelRows, mp, mpFailed, mpLastError, mail, testPayments, activations, unusedCodes] = await Promise.all([
    db.panelIntegration.findMany({ where: { resellerId: reseller.id }, select: { id: true, name: true, status: true, testMode: true, lastError: true } }),
    db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } }),
    db.subscription.count({ where: { resellerId: reseller.id, maxPlayerStatus: "FAILED" } }),
    db.subscription.findFirst({ where: { resellerId: reseller.id, maxPlayerStatus: "FAILED" }, orderBy: { updatedAt: "desc" }, select: { maxPlayerError: true, lineUsername: true } }),
    db.resellerMail.findUnique({ where: { resellerId: reseller.id }, select: { enabled: true, fromEmail: true, lastError: true } }),
    storeTestPaymentsEnabled(),
    db.order.findMany({ where: { resellerId: reseller.id, status: { in: ["COMPLETED", "ACTIVATION_FAILED", "ON_HOLD", "ACTIVATING", "PAID"] } }, orderBy: { createdAt: "desc" }, take: 8, include: { customer: true, subscription: { select: { lineUsername: true, maxPlayerStatus: true, maxPlayerError: true, maxPlayerUserId: true } } } }),
    db.activationCode.count({ where: { resellerId: reseller.id, status: "UNUSED" } }),
  ]);
  const livePanels = panelRows.filter((p) => !effectiveTestMode(p.testMode));
  const panelHealth: { tone: HealthTone; detail: string } = panelRows.length === 0
    ? { tone: "bad", detail: "No panel connected" }
    : panelRows.some((p) => p.status === "ERROR")
      ? { tone: "bad", detail: panelRows.find((p) => p.status === "ERROR")?.lastError ?? "Connection error" }
      : livePanels.length === 0
        ? { tone: "warn", detail: "Test mode — lines are simulated" }
        : { tone: "ok", detail: `${livePanels.length} panel(s) live` };
  const mpTest = !!mp && effectiveTestMode(mp.testMode);
  const mpHealth: { tone: HealthTone; detail: string } = !mp || !mp.enabled
    ? { tone: "off", detail: "Not enabled" }
    : !mp.domainId
      ? { tone: "bad", detail: "No MaxPlayer domain selected" }
      : mpFailed > 0
        ? { tone: "bad", detail: `${mpFailed} failed — ${mpLastError?.maxPlayerError ?? "see list"}` }
        : mpTest
          ? { tone: "warn", detail: "Test mode — accounts are simulated, not created" }
          : { tone: "ok", detail: "Creating accounts" };
  const mailHealth: { tone: HealthTone; detail: string } = mail?.enabled
    ? mail.lastError ? { tone: "bad", detail: mail.lastError } : { tone: "ok", detail: `From ${mail.fromEmail}` }
    : env.smtp.host ? { tone: "ok", detail: "Platform mailbox" } : { tone: "warn", detail: "Not set — emails are not sent" };
  const steps = [
    { done: !!user.emailVerifiedAt, label: "Confirm your email address", href: "/dashboard" },
    { done: panels > 0, label: "Connect your XUI One panel", href: "/dashboard/panels" },
    { done: bouquets > 0, label: "Sync bouquets from the panel", href: "/dashboard/bouquets" },
    { done: packages > 0, label: "Create a package with your own price", href: "/dashboard/packages/new" },
    { done: gateways > 0, label: "Connect a payment gateway", href: "/dashboard/payments" },
  ];
  const remaining = steps.filter((x) => !x.done);

  return (
    <>
      <PageHeader
        title="Overview"
        description={<>Your store: <a href={storeBaseUrl(reseller)} target="_blank" rel="noreferrer">{storeBaseUrl(reseller).replace(/^https?:\/\//, "")}</a></>}
        actions={<><Link className="btn-secondary" href="/dashboard/packages/new">New package</Link><Link className="btn-primary" href="/dashboard/customers/new">+ Add customer</Link></>}
      />
      <Flash sp={sp} />

      <section aria-label="System status" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HealthItem tone={panelHealth.tone} title="XUI panel" detail={panelHealth.detail} href="/dashboard/panels" />
        <HealthItem tone={mpHealth.tone} title="MaxPlayer" detail={mpHealth.detail} href="/dashboard/maxplayer" />
        <HealthItem tone={mailHealth.tone} title="Email" detail={mailHealth.detail} href="/dashboard/mail" />
        <HealthItem tone={testPayments ? "warn" : "ok"} title="Payments" detail={testPayments ? "Test mode — payments are simulated" : `${gateways} gateway(s) · ${unusedCodes} unused code(s)`} href={testPayments ? "/dashboard/payments" : "/dashboard/codes"} />
      </section>

      {(mpFailed > 0 || s.failedActivations > 0) && (
        <div className="mb-6 rounded-lg border border-rose-300 bg-rose-50 p-4 dark:border-rose-500/40 dark:bg-rose-500/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <b className="text-rose-800 dark:text-rose-200">Needs your attention</b>
              <ul className="mt-1 space-y-0.5 text-rose-800 dark:text-rose-200">
                {s.failedActivations > 0 && <li>{s.failedActivations} line activation(s) failed — <Link href="/dashboard/orders?status=attention">open</Link></li>}
                {mpFailed > 0 && <li>{mpFailed} MaxPlayer account(s) failed{mpLastError?.maxPlayerError ? `: ${mpLastError.maxPlayerError}` : ""}</li>}
              </ul>
            </div>
            {mpFailed > 0 && <form action={retryAllMaxPlayerAction}><SubmitButton className="btn-primary">Retry MaxPlayer</SubmitButton></form>}
          </div>
        </div>
      )}

      <section aria-label="Quick actions" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { href: "/dashboard/customers/new", t: "Add customer", d: "New line on the panel", icon: "+" },
          { href: "/dashboard/codes", t: "Activation codes", d: "Create and copy links", icon: "#" },
          { href: "/dashboard/customers/existing", t: "Load existing line", d: "Bring an old customer in", icon: "⇩" },
          { href: storeBaseUrl(reseller), t: "Open my store", d: "What customers see", icon: "↗" },
        ].map((q) => (
          <Link key={q.t} href={q.href} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3.5 no-underline hover:border-slate-950 hover:no-underline dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-500 text-lg font-black text-black" aria-hidden>{q.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-slate-950 dark:text-white">{q.t}</span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{q.d}</span>
            </span>
          </Link>
        ))}
      </section>

      {remaining.length > 0 && (
        <Card title="Get your store ready" description={`${steps.length - remaining.length} of ${steps.length} steps done`} className="mb-6">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((st, i) => (
              <li key={i}>
                <Link href={st.href} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm no-underline ${st.done ? "border-emerald-200 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-300" : "border-slate-200 text-slate-700 hover:border-brand-400 dark:border-slate-700 dark:text-slate-200"}`}>
                  <span aria-hidden>{st.done ? "✓" : i + 1}</span> {st.label}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total sales" value={<Totals rows={s.total} fallback={reseller.defaultCurrency} />} />
        <Stat label="Today" value={<Totals rows={s.today} fallback={reseller.defaultCurrency} />} />
        <Stat label="This month" value={<Totals rows={s.month} fallback={reseller.defaultCurrency} />} />
        <Stat label="Active customers" value={s.activeCustomers} hint={`${s.activeSubs} active subscriptions`} />
        <Stat label="Expiring in 7 days" value={s.expiringCount} tone={s.expiringCount ? "amber" : undefined} />
        <Stat label="Failed payments (30d)" value={s.failedPayments} tone={s.failedPayments ? "red" : undefined} />
        <Stat label="Activations needing attention" value={<Link href="/dashboard/orders?status=attention">{s.failedActivations}</Link>} tone={s.failedActivations ? "red" : "green"} />
        <Stat label="Active subscriptions" value={s.activeSubs} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title={`Revenue — last 30 days (${reseller.defaultCurrency})`} className="lg:col-span-2">
          <BarChart data={chart} currency={reseller.defaultCurrency} />
        </Card>
        <Card title="Best-selling packages" pad={false}>
          {s.topPackages.length === 0 ? (
            <Empty title="No sales yet" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {s.topPackages.map((p) => (
                <li key={p.name} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{p.name}</span>
                  <span className="muted">{p.count} sold · <Money amount={p.revenue} currency={p.currency} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Latest activations" className="mt-6" pad={false} actions={<Link className="btn-ghost btn-sm" href="/dashboard/orders">All orders</Link>}>
        {activations.length === 0 ? <Empty title="No activations yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Customer</th><th>Line</th><th>Line status</th><th>MaxPlayer</th></tr></thead>
              <tbody>
                {activations.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/dashboard/orders/${o.id}`}><DateTime value={o.createdAt} /></Link></td>
                    <td>{displayCustomer(o.customer.email, o.subscription?.lineUsername)}</td>
                    <td className="font-mono text-xs">{o.subscription?.lineUsername ?? o.lineUsername ?? "—"}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td title={o.subscription?.maxPlayerError ?? ""}>{o.subscription ? <StatusBadge status={o.subscription.maxPlayerUserId?.startsWith("TEST-") ? "PENDING" : o.subscription.maxPlayerStatus} label={o.subscription.maxPlayerStatus === "NONE" ? "not used" : o.subscription.maxPlayerUserId?.startsWith("TEST-") ? "simulated (test)" : undefined} /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Expiring soon" actions={<Link className="btn-ghost btn-sm" href="/dashboard/subscriptions?filter=expiring">View all</Link>} pad={false}>
          {s.expiring.length === 0 ? (
            <Empty title="Nothing expires in the next 7 days" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {s.expiring.map((x) => (
                    <tr key={x.id}>
                      <td><Link href={`/dashboard/subscriptions/${x.id}`}>{displayCustomer(x.customer.email, (x as any).lineUsername)}</Link></td>
                      <td>{x.package.name}</td>
                      <td><DateTime value={x.expiresAt} dateOnly /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Recent transactions" actions={<Link className="btn-ghost btn-sm" href="/dashboard/transactions">View all</Link>} pad={false}>
          {recent.length === 0 ? (
            <Empty title="No transactions yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {recent.map((t) => (
                    <tr key={t.id}>
                      <td><DateTime value={t.createdAt} /></td>
                      <td>{t.order?.customer.email ?? "—"}</td>
                      <td><StatusBadge status={t.type === "REFUND" ? "REFUNDED" : t.status} label={t.type === "REFUND" ? "refund" : t.provider.toLowerCase()} /></td>
                      <td className="text-right"><Money amount={t.amountCents} currency={t.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
