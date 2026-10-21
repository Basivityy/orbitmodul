import type { SaasPlan } from "@prisma/client";
import { minorToDecimalString, SUPPORTED_CURRENCIES } from "@/core/money";
import { SubmitButton } from "@/components/client";
import { Card, Field, Flash, Money, PageHeader, Toggle } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { savePlanAction } from "../actions";

export const metadata = { title: "SaaS plans" };

function PlanForm({ p }: { p?: SaasPlan }) {
  return (
    <form action={savePlanAction} className="space-y-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" name="code"><input className="input font-mono uppercase" name="code" defaultValue={p?.code ?? ""} required /></Field>
        <Field label="Name" name="name"><input className="input" name="name" defaultValue={p?.name ?? ""} required /></Field>
        <Field label="Price" name="price"><input className="input" name="price" defaultValue={p ? minorToDecimalString(p.priceCents, p.currency) : ""} required /></Field>
        <Field label="Currency" name="currency"><select className="input" name="currency" defaultValue={p?.currency ?? "EUR"}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Interval" name="interval"><select className="input" name="interval" defaultValue={p?.interval ?? "MONTH"}><option value="MONTH">Monthly</option><option value="YEAR">Yearly</option></select></Field>
        <Field label="Sort order" name="sortOrder"><input className="input" name="sortOrder" type="number" defaultValue={p?.sortOrder ?? 0} /></Field>
        <Field label="Max packages" name="maxPackages"><input className="input" name="maxPackages" type="number" min={0} defaultValue={p?.maxPackages ?? 5} /></Field>
        <Field label="Max panels" name="maxPanels"><input className="input" name="maxPanels" type="number" min={0} defaultValue={p?.maxPanels ?? 1} /></Field>
        <Field label="Max active customers" name="maxActiveCustomers"><input className="input" name="maxActiveCustomers" type="number" min={0} defaultValue={p?.maxActiveCustomers ?? 100} /></Field>
      </div>
      <Field label="Extra features (one per line)" name="features"><textarea className="input" name="features" rows={3} defaultValue={Array.isArray(p?.features) ? (p!.features as string[]).join("\n") : ""} /></Field>
      <div className="flex flex-wrap gap-5">
        <Toggle name="allowMaxPlayer" label="MaxPlayer" defaultChecked={p?.allowMaxPlayer ?? false} />
        <Toggle name="allowCustomDomain" label="Custom domain" defaultChecked={p?.allowCustomDomain ?? false} />
        <Toggle name="active" label="Available" defaultChecked={p?.active ?? true} />
        <Toggle name="isDefault" label="Default for trials" defaultChecked={p?.isDefault ?? false} />
      </div>
      <SubmitButton>{p ? "Save plan" : "Create plan"}</SubmitButton>
    </form>
  );
}

export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const plans = await db.saasPlan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }], include: { _count: { select: { subscriptions: true } } } });
  return (
    <>
      <PageHeader title="SaaS plans" description="What resellers pay you to use the platform. Limits are enforced on the backend." />
      <Flash sp={sp} />
      <div className="grid gap-6 xl:grid-cols-2">
        {plans.map((p) => (
          <Card key={p.id} title={<span>{p.name} · <Money amount={p.priceCents} currency={p.currency} />/{p.interval === "YEAR" ? "yr" : "mo"} {p.isDefault && <span className="badge-blue">default</span>} {!p.active && <span className="badge-gray">hidden</span>}</span>} description={`${p._count.subscriptions} reseller(s) on this plan`}>
            <PlanForm p={p} />
          </Card>
        ))}
        <Card title="New plan"><PlanForm /></Card>
      </div>
    </>
  );
}
