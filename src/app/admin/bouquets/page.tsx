import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { getCatalogSource } from "@/lib/bouquetCatalog";
import { db } from "@/lib/db";
import { removeCatalogKeyAction, saveCatalogSourceAction, syncCatalogAction } from "../actions";

export const metadata = { title: "Bouquet names" };

export default async function AdminBouquetsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const [src, rows] = await Promise.all([getCatalogSource(), db.bouquetCatalog.findMany({ orderBy: [{ host: "asc" }, { name: "asc" }] })]);
  const hosts = Array.from(new Set(rows.map((r) => r.host)));
  return (
    <>
      <PageHeader
        title="Bouquet names"
        description="Sync bouquet names once with your XUI admin API. Every reseller who connects the same panel with their reseller key gets the real names automatically. After the sync you can remove the admin key — the names stay saved."
      />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. Admin API (used only to read bouquet names)">
          <form action={saveCatalogSourceAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="apiUrl">Admin API URL</label>
              <input className="input" id="apiUrl" name="apiUrl" defaultValue={src?.apiUrl ?? ""} placeholder="http://your-panel.com/adminapi" required />
            </div>
            <div>
              <label className="label" htmlFor="apiKey">Admin API key</label>
              <input className="input" id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={src?.apiKeyEnc ? "•••••••• saved — leave empty to keep" : "paste the admin API key"} />
              <p className="hint mt-1">Stored encrypted. Never shown to resellers.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="intent" value="sync">Save &amp; sync bouquets</SubmitButton>
              <SubmitButton className="btn-secondary" name="intent" value="save">Save only</SubmitButton>
            </div>
          </form>
        </Card>
        <Card title="2. Status">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="muted">Admin key</dt><dd>{src?.apiKeyEnc ? <span className="badge-amber">saved</span> : <span className="badge-gray">not saved</span>}</dd></div>
            <div className="flex justify-between"><dt className="muted">Last sync</dt><dd>{src?.lastSyncedAt ? <DateTime value={new Date(src.lastSyncedAt)} /> : "never"}</dd></div>
            <div className="flex justify-between"><dt className="muted">Bouquet names saved</dt><dd>{rows.length}</dd></div>
            <div className="flex justify-between"><dt className="muted">Panels</dt><dd>{hosts.join(", ") || "—"}</dd></div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            {src?.apiKeyEnc && (
              <form action={syncCatalogAction}><SubmitButton className="btn-secondary">Sync again</SubmitButton></form>
            )}
            {src?.apiKeyEnc && (
              <form action={removeCatalogKeyAction}><SubmitButton className="btn-danger" confirm="Remove the admin API key? Saved bouquet names stay. To add new bouquets later, enter the key again and sync.">Remove admin key</SubmitButton></form>
            )}
          </div>
          <p className="hint mt-3">Added new bouquets on the panel? Enter the key again → <b>Save &amp; sync</b> → remove the key.</p>
        </Card>
      </div>
      <div className="mt-6">
        <Card title={`Saved bouquet names (${rows.length})`} pad={false}>
          {rows.length === 0 ? <Empty title="Nothing synced yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>ID</th><th>Name</th><th>Panel</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}><td className="font-mono text-xs">{r.externalId}</td><td>{r.name}</td><td className="muted text-xs">{r.host}</td></tr>
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
