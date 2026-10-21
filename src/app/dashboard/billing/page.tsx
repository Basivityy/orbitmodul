import { SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformBillingConfigured } from "@/lib/platformBilling";
import { loadResellerSaas, saasActive } from "@/lib/saas";
import { redirect } from "next/navigation";
import { resellerPlansEnabled } from "@/lib/settings";
import { cancelPlanAction, choosePlanAction } from "../actions/billing";

export const metadata = { title: "Plan & billing" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  if (!(await resellerPlansEnabled())) redirect("/dashboard");
  const full = await loadResellerSaas(reseller.id);
  const [plans, invoices] = await Promise.all([
    db.saasPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }] }),
    db.saasInvoice.findMany({ where: { resellerId: reseller.id }, orderBy: { createdAt: "desc" }, take: 24 }),
  ]);
  const s = full.saas;
  return (
    <>
      <PageHeader title="Plan & billing" description="Your subscription to the platform. This is separate from the payments your customers make to you." />
      <Flash sp={sp} />
      <Card title="Current plan" className="mb-6">
        {s ? (
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <div><div className="muted">Plan</div><div className="text-lg font-semibold">{s.plan.name}</div></div>
            <div><div className="muted">Status</div><StatusBadge status={saasActive(s) ? s.status : "EXPIRED"} /></div>
            {s.status === "TRIALING" && <div><div className="muted">Trial ends</div><DateTime value={s.trialEndsAt} dateOnly /></div>}
            {s.currentPeriodEnd && s.status !== "TRIALING" && <div><div className="muted">{s.cancelAtPeriodEnd ? "Ends on" : "Renews on"}</div><DateTime value={s.currentPeriodEnd} dateOnly /></div>}
            {s.stripeSubscriptionId && !s.cancelAtPeriodEnd && (
              <form action={cancelPlanAction} className="ml-auto"><SubmitButton className="btn-ghost text-rose-600" confirm="Cancel your plan at the end of the period?">Cancel plan</SubmitButton></form>
            )}
          </div>
        ) : <p className="muted">No plan yet.</p>}
      </Card>
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((p) => {
          const features = Array.isArray(p.features) ? (p.features as string[]) : [];
          const current = s?.planId === p.id && saasActive(s) && s.status !== "TRIALING";
          return (
            <div key={p.id} className={`card card-pad flex flex-col ${current ? "ring-2 ring-brand-500" : ""}`}>
              <h3>{p.name}</h3>
              <div className="my-3 text-3xl font-bold"><Money amount={p.priceCents} currency={p.currency} /><span className="muted text-sm font-normal"> / {p.interval === "YEAR" ? "year" : "month"}</span></div>
              <ul className="mb-5 flex-1 space-y-1.5 text-sm">
                <li>✓ Up to {p.maxPackages} packages</li>
                <li>✓ {p.maxPanels} XUI One panel{p.maxPanels > 1 ? "s" : ""}</li>
                <li>✓ Up to {p.maxActiveCustomers} active customers</li>
                <li>{p.allowMaxPlayer ? "✓" : "✗"} MaxPlayer integration</li>
                <li>{p.allowCustomDomain ? "✓" : "✗"} Custom domain</li>
                {features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
              {current ? <span className="btn-secondary pointer-events-none">Current plan</span> : (
                <form action={choosePlanAction}>
                  <input type="hidden" name="planId" value={p.id} />
                  <SubmitButton className="btn-primary w-full">{platformBillingConfigured() ? "Choose plan" : "Choose plan (contact admin)"}</SubmitButton>
                </form>
              )}
            </div>
          );
        })}
      </div>
      <Card title="Invoices" pad={false} className="mt-6">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Invoice</th><th>Date</th><th>Period end</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}><td className="font-mono">{i.number}</td><td><DateTime value={i.paidAt ?? i.createdAt} dateOnly /></td><td><DateTime value={i.periodEnd} dateOnly /></td><td><Money amount={i.amountCents} currency={i.currency} /></td><td><StatusBadge status={i.status === "PAID" ? "SUCCEEDED" : i.status} label={i.status.toLowerCase()} /></td></tr>
              ))}
              {invoices.length === 0 && <tr><td colSpan={5} className="muted">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
