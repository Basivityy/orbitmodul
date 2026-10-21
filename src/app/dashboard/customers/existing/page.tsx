import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, Field, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadExistingLineAction } from "../../actions/customers";

export const metadata = { title: "Load existing line" };

export default async function LoadExistingLinePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const [panels, mp] = await Promise.all([
    db.panelIntegration.findMany({ where: { resellerId: reseller.id }, orderBy: { createdAt: "asc" } }),
    db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id }, select: { id: true } }),
  ]);
  return (
    <>
      <PageHeader title="Load existing line" description="For customers who already have a line on your panel. The line is read from the panel (nothing is changed there). Afterwards the customer can extend it on your store with their username, and you can manage or delete it here." />
      <Flash sp={sp} />
      {panels.length === 0 ? (
        <Card><p className="muted">Connect your XUI panel first: <Link href="/dashboard/panels">XUI One panels</Link>.</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <form action={loadExistingLineAction} className="space-y-5">
              {panels.length > 1 ? (
                <Field label="XUI panel" name="panelId">
                  <select className="input" id="panelId" name="panelId">{panels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                </Field>
              ) : (
                <input type="hidden" name="panelId" value={panels[0].id} />
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Line ID" name="lineId" hint="On the panel, open the line — the number after id= in the address bar.">
                  <input className="input font-mono" id="lineId" name="lineId" inputMode="numeric" pattern="[0-9]{1,12}" required placeholder="73736" />
                </Field>
                <Field label="Username" name="username">
                  <input className="input font-mono" id="username" name="username" required autoComplete="off" maxLength={60} />
                </Field>
                <Field label="Password" name="password">
                  <input className="input font-mono" id="password" name="password" required autoComplete="off" maxLength={60} />
                </Field>
              </div>
              <Field label="Customer email (optional)" name="email" hint="Empty = added without email. The customer's email is saved automatically the first time they pay on your store.">
                <input className="input" id="email" name="email" type="email" autoComplete="off" />
              </Field>
              <Toggle name="checkMaxPlayer" label="Check if this customer already uses MaxPlayer" defaultChecked={!!mp} hint={mp ? "If a MaxPlayer account with this username exists, it is linked. A MaxPlayer account is never created for loaded lines — also not when they renew." : "MaxPlayer is not connected — the line is loaded without MaxPlayer."} />
              <SubmitButton>Load line</SubmitButton>
            </form>
          </Card>
          <Card title="What happens">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>We read the line by its ID from your panel and check that username and password match and that it is your line.</li>
              <li>Expiry date, status and password are copied into billing.</li>
              <li>The customer can now extend on your store: <b>Extend</b> → username → choose package → pay. The same line is extended.</li>
              <li>Deleting this customer here also deletes the line on the panel and the MaxPlayer account (you can untick that).</li>
            </ol>
          </Card>
        </div>
      )}
    </>
  );
}
