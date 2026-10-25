import Link from "next/link";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { scanEnd } from "@/core/lineScan";
import { Card, DateTime, Field, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { lineImportAction, loadExistingLineAction } from "../../actions/customers";

export const metadata = { title: "Load existing line" };

export default async function LoadExistingLinePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const [panels, mp] = await Promise.all([
    db.panelIntegration.findMany({ where: { resellerId: reseller.id }, orderBy: { createdAt: "asc" } }),
    db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id }, select: { id: true } }),
  ]);
  const imports = await db.lineImport.findMany({ where: { resellerId: reseller.id } });
  const running = imports.some((i) => i.status === "RUNNING" || i.status === "QUEUED");
  return (
    <>
      <PageHeader title="Load existing line" description="For customers who already have a line on your panel. The line is read from the panel (nothing is changed there). Afterwards the customer can extend it on your store with their username, and you can manage or delete it here." />
      <Flash sp={sp} />
      <AutoRefresh active={running} intervalMs={5000} />
      {panels.length > 0 && (
        <Card className="mb-6" title="Import all my lines" description="Brings every line you own on the panel into billing at once — in the background, without changing anything on the panel. Customers can then extend on your store with their username.">
          <div className="space-y-5">
            {panels.map((p) => {
              const li = imports.find((i) => i.panelId === p.id);
              const busy = li?.status === "RUNNING" || li?.status === "QUEUED";
              const end = li ? scanEnd(li) : 0;
              const pct = li && end ? Math.min(100, Math.round(((li.nextId - 1) / end) * 100)) : 0;
              return (
                <div key={p.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  {panels.length > 1 && <div className="mb-2 font-semibold">{p.name}</div>}
                  {li && (
                    <div className="mb-4">
                      <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                        <span>
                          {busy ? <b>Importing… {pct}%</b> : li.status === "DONE" ? <b className="text-emerald-600">Done</b> : li.status === "ERROR" ? <b className="text-rose-600">Stopped by an error</b> : li.status === "STOPPED" ? <b>Stopped</b> : null}
                          {" "}· {li.found} of your lines found · <b>{li.imported}</b> new in billing · {li.updated} updated
                        </span>
                        <span className="muted">checked {li.scanned.toLocaleString()} ids (up to #{(li.nextId - 1).toLocaleString()} of ~{end.toLocaleString()}){li.finishedAt ? <> · finished <DateTime value={li.finishedAt} /></> : null}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-800"><div className="h-2 bg-brand-500" style={{ width: `${pct}%` }} /></div>
                      {li.lastError && <p className="mt-2 text-sm text-rose-600">{li.lastError}</p>}
                    </div>
                  )}
                  <form action={lineImportAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="panelId" value={p.id} />
                    {busy ? (
                      <SubmitButton className="btn-secondary" name="op" value="stop">Stop</SubmitButton>
                    ) : (
                      <>
                        <div>
                          <label className="label" htmlFor={`ceiling-${p.id}`}>Highest line ID on the panel (optional)</label>
                          <input className="input w-44 font-mono" id={`ceiling-${p.id}`} name="ceiling" inputMode="numeric" pattern="[0-9]{1,9}" placeholder={li?.ceiling ? String(li.ceiling) : "e.g. 80000"} />
                        </div>
                        <SubmitButton className="btn-primary" name="op" value="full" confirm={li ? "Check all lines on the panel again from the start?" : undefined}>{li ? "Import all again" : "Import all my lines"}</SubmitButton>
                        {li && (li.status === "STOPPED" || li.status === "ERROR") && <SubmitButton className="btn-secondary" name="op" value="continue">Continue</SubmitButton>}
                        {li?.status === "DONE" && <SubmitButton className="btn-secondary" name="op" value="new">Check for new lines</SubmitButton>}
                      </>
                    )}
                  </form>
                </div>
              );
            })}
            <ul className="list-disc space-y-1 pl-5 text-sm muted">
              <li>Your panel cannot list lines, so every line id is checked one by one and only lines that <b>belong to your account</b> are taken. For a big panel this takes 1–3 hours — it continues on its own, also after a restart.</li>
              <li>Highest line ID: the newest line on the panel (open the newest line, the number after id=). Leave empty — we estimate it and keep going while your lines turn up.</li>
              <li>Imported lines have no email until the customer pays once on your store. No MaxPlayer account is created for them.</li>
            </ul>
          </div>
        </Card>
      )}
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
