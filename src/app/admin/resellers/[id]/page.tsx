import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/core/money";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { saasActive } from "@/lib/saas";
import { resellerStats } from "@/lib/stats";
import { resellerPlansEnabled } from "@/lib/settings";
import { storeBaseUrl } from "@/lib/urls";
import { approveResellerAction, rejectResellerAction, setResellerBillingAction, setResellerPlanAction, setResellerStatusAction, setResellerVodAction, confirmResellerEmailAction, setResellerApiAction } from "../../actions";

export const metadata = { title: "Reseller" };

export default async function AdminResellerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const r = await db.reseller.findUnique({ where: { id }, include: { owner: true, saas: { include: { plan: true } }, panels: true, gateways: true, maxPlayer: true, vodMonitor: true } });
  if (!r) notFound();
  const [stats, plans, orders, audits, plansOn] = await Promise.all([
    resellerStats(r.id),
    db.saasPlan.findMany({ orderBy: { sortOrder: "asc" } }),
    db.order.findMany({ where: { resellerId: r.id }, orderBy: { createdAt: "desc" }, take: 10, include: { customer: true } }),
    db.auditLog.findMany({ where: { resellerId: r.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    resellerPlansEnabled(),
  ]);
  const hidden = <input type="hidden" name="resellerId" value={r.id} />;
  return (
    <>
      <PageHeader title={r.storeName} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} /> {r.owner.email} · <a href={storeBaseUrl(r)} target="_blank" rel="noreferrer">store ↗</a></span>} />
      <Flash sp={sp} />
      {r.approvalStatus !== "APPROVED" && (
        <Card className="mb-6" title={r.approvalStatus === "PENDING" ? "Waiting for your approval" : "Application declined"} description={<>{r.owner.name} · {r.owner.email} · registered <DateTime value={r.createdAt} /> · {r.owner.emailVerifiedAt ? "email confirmed" : "email not confirmed yet"}</>}>
          {r.approvalStatus === "REJECTED" && r.approvalNote && <p className="mb-3 text-sm">Reason given: {r.approvalNote}</p>}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form action={approveResellerAction}>
              {hidden}
              <SubmitButton className="btn-primary">✓ Approve reseller</SubmitButton>
            </form>
            {r.approvalStatus === "PENDING" && (
              <form action={rejectResellerAction} className="flex flex-1 flex-wrap items-center gap-2">
                {hidden}
                <input className="input max-w-sm flex-1" name="reason" placeholder="Reason (optional, sent to them)" maxLength={500} />
                <SubmitButton className="btn-ghost text-rose-600" confirm="Decline this reseller?">✕ Decline</SubmitButton>
              </form>
            )}
          </div>
          <p className="hint mt-3">Until approved they cannot open their dashboard and their store cannot sell. They get an email when you decide.</p>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total sales" value={stats.total.length ? formatMoney(stats.total[0].amount, stats.total[0].currency) : "—"} />
        <Stat label="Active subscriptions" value={stats.activeSubs} />
        <Stat label="Active customers" value={stats.activeCustomers} />
        <Stat label="Failed activations" value={stats.failedActivations} tone={stats.failedActivations ? "red" : undefined} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Account control">
          <div className="space-y-4">
            <form action={setResellerStatusAction} className="space-y-2">
              {hidden}
              {r.status === "ACTIVE" ? (
                <>
                  <input className="input" name="reason" placeholder="Reason (optional, for the audit log)" />
                  <input type="hidden" name="status" value="SUSPENDED" />
                  <SubmitButton className="btn-danger w-full" confirm="Suspend this reseller? Their dashboard and store go offline and automation pauses. Customer lines on their panel are NOT changed.">Suspend reseller</SubmitButton>
                </>
              ) : (
                <><input type="hidden" name="status" value="ACTIVE" /><SubmitButton className="w-full">Re-activate reseller</SubmitButton></>
              )}
            </form>
            <form action={setResellerBillingAction}>
              {hidden}
              <input type="hidden" name="enabled" value={r.billingEnabled ? "false" : "true"} />
              <SubmitButton className={r.billingEnabled ? "btn-secondary w-full" : "btn-primary w-full"} confirm={r.billingEnabled ? "Disable the billing module for this reseller?" : undefined}>
                {r.billingEnabled ? "Temporarily disable billing module" : "Enable billing module"}
              </SubmitButton>
            </form>
            <p className="hint">Billing module: {r.billingEnabled ? "enabled" : "disabled"}. When disabled, checkouts are closed and paid orders wait ON HOLD.</p>
            {!r.owner.emailVerifiedAt && (
              <form action={confirmResellerEmailAction}>
                {hidden}
                <SubmitButton className="btn-primary w-full">✓ Confirm email manually</SubmitButton>
                <p className="hint mt-1">{r.owner.email} has not confirmed the email — the store cannot sell until it is confirmed.</p>
              </form>
            )}
            <form action={setResellerApiAction}>
              {hidden}
              <input type="hidden" name="enabled" value={r.partnerApiEnabled ? "false" : "true"} />
              <SubmitButton className="btn-secondary w-full" confirm={r.partnerApiEnabled ? "Switch off the Website API, webhooks and widget for this reseller? Their website integration stops at once." : undefined}>
                {r.partnerApiEnabled ? "Disable Website API & widget" : "Enable Website API & widget"}
              </SubmitButton>
            </form>
            <form action={setResellerVodAction}>
              {hidden}
              <input type="hidden" name="enabled" value={r.vodMonitorEnabled ? "false" : "true"} />
              <SubmitButton className={r.vodMonitorEnabled ? "btn-secondary w-full" : "btn-primary w-full"} confirm={r.vodMonitorEnabled ? "Disable VOD monitoring for this reseller?" : undefined}>
                {r.vodMonitorEnabled ? "Disable VOD monitoring" : "◫ Enable VOD monitoring"}
              </SubmitButton>
            </form>
            <p className="hint">
              VOD monitoring: {r.vodMonitorEnabled ? "enabled" : "off"}
              {r.vodMonitor ? <> · last scan {r.vodMonitor.lastScanAt ? <DateTime value={r.vodMonitor.lastScanAt} /> : "never"} · {r.vodMonitor.seriesCount} series, {r.vodMonitor.missingCount} with missing episodes{r.vodMonitor.status === "ERROR" ? ` · error: ${r.vodMonitor.lastError ?? ""}` : ""}</> : r.vodMonitorEnabled ? " · no monitoring line entered yet" : ""}.
            </p>
            <Link className="btn-secondary w-full" href={`/admin/customers?reseller=${r.id}`}>☷ All customers &amp; lines of this reseller</Link>
            <Link className="btn-secondary w-full" href={`/admin/announcements?target=${r.id}`}>📣 Send a dashboard notification</Link>
            {r.approvalStatus === "APPROVED" && <p className="hint">Approved{r.approvedAt ? <> on <DateTime value={r.approvedAt} dateOnly /></> : " (existing account)"}.</p>}
          </div>
        </Card>
        {plansOn && <Card title="Platform subscription">
          <p className="mb-3 text-sm">{r.saas ? <>{r.saas.plan.name} · <StatusBadge status={saasActive(r.saas) ? r.saas.status : "EXPIRED"} /> {r.saas.status === "TRIALING" ? <>trial until <DateTime value={r.saas.trialEndsAt} dateOnly /></> : <>until <DateTime value={r.saas.currentPeriodEnd} dateOnly /></>}{r.saas.stripeSubscriptionId && <span className="muted block text-xs">Stripe: {r.saas.stripeSubscriptionId}</span>}</> : "No subscription"}</p>
          <form action={setResellerPlanAction} className="space-y-2">
            {hidden}
            <select className="input" name="planId" defaultValue={r.saas?.planId}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatMoney(p.priceCents, p.currency)}/{p.interval.toLowerCase()})</option>)}</select>
            <select className="input" name="status" defaultValue={r.saas?.status ?? "ACTIVE"}>{["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"].map((s) => <option key={s}>{s}</option>)}</select>
            <input className="input" name="until" type="date" defaultValue={(r.saas?.status === "TRIALING" ? r.saas.trialEndsAt : r.saas?.currentPeriodEnd)?.toISOString().slice(0, 10)} />
            <SubmitButton className="btn-secondary w-full">Update manually</SubmitButton>
            <p className="hint">Use for manual payments, extensions or comped accounts.</p>
          </form>
        </Card>}
        <Card title="Integrations">
          <ul className="space-y-2 text-sm">
            {r.panels.map((p) => <li key={p.id} className="flex justify-between"><span>Panel: {p.name}</span><span><StatusBadge status={p.status} /> {p.testMode && <span className="badge-amber">test</span>}</span></li>)}
            {r.gateways.map((g) => <li key={g.id} className="flex justify-between"><span>{g.provider.toLowerCase()}</span>{g.enabled ? <span className="badge-green">enabled</span> : <span className="badge-gray">disabled</span>}</li>)}
            <li className="flex justify-between"><span>MaxPlayer</span>{r.maxPlayer ? <StatusBadge status={r.maxPlayer.status} /> : <span className="muted">—</span>}</li>
          </ul>
          <p className="hint mt-3">Credentials are encrypted and not visible to administrators.</p>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Recent orders" pad={false}>
          <div className="table-wrap"><table className="table"><tbody>
            {orders.map((o) => <tr key={o.id}><td className="font-mono text-xs">{o.number}</td><td>{o.customer.email}</td><td><Money amount={o.amountCents} currency={o.currency} /></td><td><StatusBadge status={o.status} /></td></tr>)}
          </tbody></table></div>
        </Card>
        <Card title="Audit trail" pad={false} actions={<Link className="btn-ghost btn-sm" href={`/admin/audit?reseller=${r.id}`}>All</Link>}>
          <div className="table-wrap"><table className="table"><tbody>
            {audits.map((a) => <tr key={a.id}><td><DateTime value={a.createdAt} /></td><td className="font-mono text-xs">{a.action}</td><td className="text-xs">{a.actorEmail ?? a.actorRole}</td></tr>)}
          </tbody></table></div>
        </Card>
      </div>
    </>
  );
}
