import Link from "next/link";
import type { Bouquet, Package, PanelIntegration } from "@prisma/client";
import { minorToDecimalString, SUPPORTED_CURRENCIES } from "@/core/money";
import { SubmitButton } from "@/components/client";
import { Field, Toggle } from "@/components/ui";
import { savePackageAction } from "../actions/packages";
import type { PanelPackageOption } from "@/lib/panelPackages";

type PanelWithBouquets = PanelIntegration & { bouquets: Bouquet[] };

export function PackageForm({ pkg, selected, panels, defaultCurrency, allowMaxPlayer, maxPlayerDefault = false, panelPackages = [] }: { pkg?: Package; selected: string[]; panels: PanelWithBouquets[]; defaultCurrency: string; allowMaxPlayer: boolean; maxPlayerDefault?: boolean; panelPackages?: PanelPackageOption[] }) {
  const currency = pkg?.currency ?? defaultCurrency;
  if (panels.length === 0) {
    return <p className="muted">Connect a XUI One panel and sync its bouquets first: <Link href="/dashboard/panels">XUI One panels</Link>.</p>;
  }
  return (
    <form action={savePackageAction} className="space-y-6">
      {pkg && <input type="hidden" name="id" value={pkg.id} />}
      <div className="grid-form">
        <Field label="Package name" name="name">
          <input className="input" id="name" name="name" required maxLength={80} defaultValue={pkg?.name ?? ""} placeholder="e.g. BASIC 30 days" />
        </Field>
        <Field label="XUI One panel" name="panelId">
          <select className="input" id="panelId" name="panelId" defaultValue={pkg?.panelId ?? panels[0].id}>
            {panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Panel package" name="externalPackageId" hint="The package on your XUI panel this one creates lines from. Required when the panel is connected with a reseller API key.">
        <select className="input" id="externalPackageId" name="externalPackageId" defaultValue={pkg?.externalPackageId ?? ""}>
          <option value="">— not linked —</option>
          {pkg?.externalPackageId && !panelPackages.some((o) => o.id === pkg.externalPackageId) && <option value={pkg.externalPackageId}>Panel package #{pkg.externalPackageId}</option>}
          {panelPackages.map((o) => (
            <option key={o.panelId + o.id} value={o.id}>{panels.length > 1 ? `${panels.find((p) => p.id === o.panelId)?.name ?? ""}: ` : ""}{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Description (shown in your store)" name="description">
        <textarea className="input" id="description" name="description" rows={2} maxLength={1000} defaultValue={pkg?.description ?? ""} />
      </Field>

      <fieldset className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <legend className="px-1 text-sm font-semibold">Your price</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Price" name="price">
            <input className="input" id="price" name="price" inputMode="decimal" required defaultValue={pkg ? minorToDecimalString(pkg.priceCents, pkg.currency) : ""} placeholder="10.00" />
          </Field>
          <Field label="Currency" name="currency">
            <select className="input" id="currency" name="currency" defaultValue={currency}>
              {SUPPORTED_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Promo price (optional)" name="promoPrice">
            <input className="input" id="promoPrice" name="promoPrice" inputMode="decimal" defaultValue={pkg?.promoPriceCents != null ? minorToDecimalString(pkg.promoPriceCents, pkg.currency) : ""} />
          </Field>
          <Field label="Promo ends" name="promoEndsAt">
            <input className="input" id="promoEndsAt" name="promoEndsAt" type="datetime-local" defaultValue={pkg?.promoEndsAt ? pkg.promoEndsAt.toISOString().slice(0, 16) : ""} />
          </Field>
        </div>
        <p className="hint mt-3">Price changes apply to new purchases and manual renewals. Existing paid periods keep their price, and auto-renewing subscriptions keep the price they were started with.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Duration (days)" name="durationDays">
          <input className="input" id="durationDays" name="durationDays" type="number" min={1} max={3650} required defaultValue={pkg?.durationDays ?? 30} />
        </Field>
        <Field label="Max connections" name="maxConnections">
          <input className="input" id="maxConnections" name="maxConnections" type="number" min={1} max={100} required defaultValue={pkg?.maxConnections ?? 1} />
        </Field>
        <Field label="Billing" name="billingType" hint="Auto-renew is charged automatically (Stripe). Other gateways sell it as one-time.">
          <select className="input" id="billingType" name="billingType" defaultValue={pkg?.billingType ?? "ONE_TIME"}>
            <option value="ONE_TIME">One-time payment</option>
            <option value="RECURRING">Automatic renewal</option>
          </select>
        </Field>
        <Field label="Sort order" name="sortOrder">
          <input className="input" id="sortOrder" name="sortOrder" type="number" defaultValue={pkg?.sortOrder ?? 0} />
        </Field>
      </div>

      <fieldset className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <legend className="px-1 text-sm font-semibold">Bouquets included</legend>
        {panels.map((p) => (
          <div key={p.id} className="mb-3">
            <div className="muted mb-2 text-xs font-semibold uppercase">{p.name}</div>
            {p.bouquets.length === 0 ? (
              <p className="muted">No bouquets loaded yet — open <Link href={`/dashboard/panels/${p.id}`}>the panel</Link> and click “Sync bouquets” (they are loaded automatically when you click “Connect &amp; test”).</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {p.bouquets.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                    <input type="checkbox" className="checkbox" name="bouquets" value={b.id} defaultChecked={selected.includes(b.id)} />
                    {b.name} <span className="muted text-xs">#{b.externalId}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        <p className="hint">Only bouquets from the selected panel are accepted.</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <Toggle name="active" label="On sale" defaultChecked={pkg?.active ?? true} hint="Visible and purchasable in your store." />
        <Toggle name="maxPlayerEnabled" label="Activate MaxPlayer" defaultChecked={pkg?.maxPlayerEnabled ?? maxPlayerDefault} hint={allowMaxPlayer ? "Create a MaxPlayer account for each buyer." : "Not included in your plan."} />
        <Toggle name="isTrial" label="Trial line" defaultChecked={pkg?.isTrial ?? false} hint="Marks the line as trial on the panel." />
      </div>
      <SubmitButton>Save package</SubmitButton>
    </form>
  );
}
