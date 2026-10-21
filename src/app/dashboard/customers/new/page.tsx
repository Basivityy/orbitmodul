import Link from "next/link";
import { minorToDecimalString } from "@/core/money";
import { SubmitButton } from "@/components/client";
import { Card, Field, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { addCustomerManuallyAction } from "../../actions/customers";

export const metadata = { title: "Add customer" };

export default async function AddCustomerPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } });
  const mpReady = !!(mp?.enabled && mp.domainId);
  const packages = await db.package.findMany({ where: { resellerId: reseller.id }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], include: { panel: true } });
  return (
    <>
      <PageHeader title="Add customer manually" description="Choose a package — the line is created on your panel automatically with the package's duration and price, exactly like an online purchase." />
      <Flash sp={sp} />
      {packages.length === 0 ? (
        <Card><p className="muted">Create a package first: <Link href="/dashboard/packages/new">New package</Link>.</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <form action={addCustomerManuallyAction} className="space-y-5">
              <div className="grid-form">
                <Field label="Customer email (optional, recommended)" name="email" hint="Recommended: the customer gets the login details by email and can use the customer portal. Empty = no emails, you give the details yourself.">
                  <input className="input" id="email" name="email" type="email" autoComplete="off" placeholder="customer@email.com" />
                </Field>
                <Field label="Name (optional)" name="name">
                  <input className="input" id="name" name="name" maxLength={100} />
                </Field>
              </div>

              <Field label="Package" name="packageId" hint="Duration, price, bouquets and connections come from the package.">
                <select className="input" id="packageId" name="packageId" required>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.durationDays === 1 ? "1 day" : `${p.durationDays} days`}{p.isTrial ? " (test)" : ""} — {p.priceCents > 0 ? `${minorToDecimalString(p.priceCents, p.currency)} ${p.currency}` : "free"}{p.active ? "" : " (hidden in store)"}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username on the panel" name="username" hint="The line is created on XUI with exactly this username. Empty = generated automatically.">
                  <input className="input font-mono" id="username" name="username" autoComplete="off" placeholder="e.g. marko123" pattern="[a-zA-Z0-9_.\-]{4,40}" />
                </Field>
                <Field label="Password" name="password" hint="Empty = generated automatically.">
                  <input className="input font-mono" id="password" name="password" autoComplete="off" pattern="[a-zA-Z0-9_.\-]{4,40}" />
                </Field>
              </div>

              <Field label="Notes (optional)" name="note" hint="Saved with the customer here and in the line's notes on the XUI panel.">
                <textarea className="input" id="note" name="note" rows={2} maxLength={500} placeholder="e.g. paid cash 12.10., Samsung TV, friend of Marko" />
              </Field>

              <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="text-sm font-semibold">Activation</div>
                <p className="text-sm">✓ XUI One line is created automatically on the package&apos;s panel.</p>
                <Toggle name="maxplayer" label="Also create the MaxPlayer account automatically" defaultChecked={mpReady} hint={mpReady ? "Uses the same username and password as the line." : "MaxPlayer is not set up yet — configure it on the MaxPlayer page first."} />
                <Toggle name="notify" label="Email the access details to the customer" defaultChecked hint="Only when an email is entered above." />
              </div>
              <SubmitButton>Add customer &amp; create line</SubmitButton>
            </form>
          </Card>
          <Card title="What happens">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>The customer appears under <b>Customers</b>.</li>
              <li>The line is created on the package&apos;s XUI panel with its bouquets and expiry.</li>
              <li>MaxPlayer is activated if the package has it enabled.</li>
              <li>You see the username and password on the next page; with an email the customer also gets them by email and can log in to the portal.</li>
            </ol>
            {!env.liveOperationsAllowed && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Platform test mode is on: the line is simulated, not created on the real panel.</p>}
            <p className="hint mt-4">To extend an existing customer, open their subscription and use <b>Extend</b>.</p>
          </Card>
        </div>
      )}
    </>
  );
}
