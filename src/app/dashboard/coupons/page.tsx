import { minorToDecimalString, SUPPORTED_CURRENCIES } from "@/core/money";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Field, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveCouponAction, toggleCouponAction } from "../actions/packages";

export const metadata = { title: "Coupons" };

export default async function CouponsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const [coupons, packages] = await Promise.all([
    db.coupon.findMany({ where: { resellerId: reseller.id }, orderBy: { createdAt: "desc" } }),
    db.package.findMany({ where: { resellerId: reseller.id }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="Coupons & discounts" description="Percentage or fixed-amount discounts your customers enter at checkout." />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Coupons" pad={false} className="lg:col-span-2">
          {coupons.length === 0 ? <Empty title="No coupons yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Code</th><th>Discount</th><th>Used</th><th>Valid until</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {coupons.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono font-medium">{c.code}</td>
                      <td>{c.type === "PERCENT" ? `${c.value}%` : `${minorToDecimalString(c.value, c.currency ?? "EUR")} ${c.currency}`}{c.packageIds.length ? <span className="muted text-xs"> · {c.packageIds.length} package(s)</span> : null}</td>
                      <td>{c.redemptions}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</td>
                      <td><DateTime value={c.validUntil} /></td>
                      <td>{c.active ? <span className="badge-green">active</span> : <span className="badge-gray">inactive</span>}</td>
                      <td className="text-right">
                        <form action={toggleCouponAction} className="inline-flex gap-1">
                          <input type="hidden" name="id" value={c.id} />
                          <SubmitButton className="btn-ghost btn-sm" name="op" value="toggle">{c.active ? "Disable" : "Enable"}</SubmitButton>
                          <SubmitButton className="btn-ghost btn-sm text-rose-600" name="op" value="delete" confirm="Delete this coupon?">Delete</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="New coupon">
          <form action={saveCouponAction} className="space-y-4">
            <Field label="Code" name="code"><input className="input font-mono uppercase" id="code" name="code" required placeholder="SUMMER20" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type" name="type">
                <select className="input" id="type" name="type"><option value="PERCENT">Percent %</option><option value="FIXED">Fixed amount</option></select>
              </Field>
              <Field label="Value" name="value"><input className="input" id="value" name="value" required placeholder="20" /></Field>
            </div>
            <Field label="Currency (fixed amount only)" name="currency">
              <select className="input" id="currency" name="currency" defaultValue={reseller.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valid until" name="validUntil"><input className="input" id="validUntil" name="validUntil" type="date" /></Field>
              <Field label="Max uses" name="maxRedemptions"><input className="input" id="maxRedemptions" name="maxRedemptions" type="number" min={1} /></Field>
            </div>
            {packages.length > 0 && (
              <Field label="Limit to packages (optional)" name="packageIds">
                <select className="input" id="packageIds" name="packageIds" multiple size={Math.min(packages.length, 5)}>
                  {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            )}
            <SubmitButton className="btn-primary w-full">Create coupon</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
