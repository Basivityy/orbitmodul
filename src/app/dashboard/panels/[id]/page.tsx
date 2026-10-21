import { notFound } from "next/navigation";
import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deletePanelAction, loadPanelPackagesAction, syncBouquetsAction, testPanelAction } from "../../actions/panels";
import { PanelForm } from "../PanelForm";
import { decrypt } from "@/core/crypto";
import { XuiOneAdapter } from "@/core/adapters/xui";

export const metadata = { title: "Panel" };

export default async function PanelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await requireReseller();
  const panel = await db.panelIntegration.findFirst({ where: { id, resellerId: reseller.id }, include: { bouquets: { orderBy: { name: "asc" } } } });
  if (!panel) notFound();
  // Admin API panels can list XUI users so the reseller can pick who owns new lines.
  let owners: Array<{ id: string; username: string; credits: string | null }> = [];
  try {
    owners = await new XuiOneAdapter({ apiUrl: panel.apiUrl, apiKey: decrypt(panel.apiKeyEnc), timeoutMs: 8000 }).getUsers();
  } catch {
    owners = [];
  }
  const errors = await db.apiLog.findMany({ where: { resellerId: reseller.id, service: "XUI", success: false }, orderBy: { createdAt: "desc" }, take: 5 });
  return (
    <>
      <PageHeader
        title={panel.name}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={panel.status} /> {panel.testMode || !env.liveOperationsAllowed ? <span className="badge-amber">test mode</span> : <span className="badge-green">live</span>} {panel.credits !== null && <span className="badge-gray">credits: {panel.credits}</span>}</span>}
        actions={
          <>
            <form action={testPanelAction}><input type="hidden" name="id" value={panel.id} /><SubmitButton className="btn-secondary">Test connection</SubmitButton></form>
            <form action={loadPanelPackagesAction}><input type="hidden" name="id" value={panel.id} /><SubmitButton className="btn-secondary">Load panel packages</SubmitButton></form>
            <form action={syncBouquetsAction}><input type="hidden" name="id" value={panel.id} /><SubmitButton>Sync bouquets</SubmitButton></form>
          </>
        }
      />
      <Flash sp={sp} />
      {panel.lastError && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          Last error (<DateTime value={panel.lastCheckedAt} />): {panel.lastError}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Settings" className="lg:col-span-2">
          <PanelForm panel={panel} owners={owners} />
        </Card>
        <div className="space-y-6">
          <Card title="Existing customers">
            <p className="text-sm">Customers who already have a line on this panel: add them one by one with <Link href="/dashboard/customers/existing">Load existing line</Link> (line ID, username and password). After that they can extend on your store with their username.</p>
          </Card>
          <Card title={`Bouquets (${panel.bouquets.length})`} actions={<Link href="/dashboard/bouquets" className="btn-ghost btn-sm">Manage</Link>}>
            {panel.bouquets.length === 0 ? (
              <p className="muted">Click “Sync bouquets” to load them from the panel.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {panel.bouquets.map((b) => (
                  <li key={b.id} className="flex justify-between"><span>{b.name}</span><span className="muted">#{b.externalId}</span></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent API errors">
            {errors.length === 0 ? <p className="muted">No errors.</p> : (
              <ul className="space-y-2 text-xs">
                {errors.map((e) => <li key={e.id}><DateTime value={e.createdAt} /> · <b>{e.action}</b> · {e.message}</li>)}
              </ul>
            )}
          </Card>
          <Card title="Danger zone">
            <form action={deletePanelAction}>
              <input type="hidden" name="id" value={panel.id} />
              <SubmitButton className="btn-danger" confirm="Remove this panel connection? Lines on the panel are not touched.">Remove panel</SubmitButton>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
