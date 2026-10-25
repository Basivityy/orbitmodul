import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlaceholderBouquetName } from "@/core/catalog";
import { renameBouquetAction, syncBouquetsAction } from "../actions/panels";

export const metadata = { title: "Bouquet management" };

export default async function BouquetsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const panels = await db.panelIntegration.findMany({
    where: { resellerId: reseller.id },
    include: {
      bouquets: true,
    },
  });
  // Named bouquets first (A–Z, numbers in natural order), unnamed "Bouquet #id" ones after them.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  for (const p of panels) p.bouquets.sort((a, b) => Number(isPlaceholderBouquetName(a.name) || !a.name.trim()) - Number(isPlaceholderBouquetName(b.name) || !b.name.trim()) || collator.compare(a.name, b.name));
  return (
    <>
      <PageHeader title="Bouquet management" description="Bouquet names from your XUI panel. You can rename a bouquet here — the name shows in your store." />
      <Flash sp={sp} />
      {panels.length === 0 && (
        <Card><Empty title="No panel connected">Connect your panel on the <Link href="/dashboard/panels">XUI One panels</Link> page first.</Empty></Card>
      )}
      <div className="space-y-6">
        {panels.map((p) => {
          const latest = p.bouquets.reduce<Date | null>((m, b) => (!m || b.syncedAt > m ? b.syncedAt : m), null);
          const unnamed = p.bouquets.filter((b) => isPlaceholderBouquetName(b.name) || !b.name.trim()).length;
          return (
            <Card
              key={p.id}
              title={p.name}
              description={<>Last sync: <DateTime value={latest} /></>}
              actions={
                <form action={syncBouquetsAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="back" value="/dashboard/bouquets" />
                  <SubmitButton>Sync bouquets</SubmitButton>
                </form>
              }
              pad={false}
            >
              {p.bouquets.length > 0 && (
                <p className="border-b border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
                  {p.bouquets.length} bouquets{unnamed ? <> · <b className="text-amber-600">{unnamed} without a name</b> — the platform admin can load the names (Admin → Bouquet names), or type a name and click Save</> : " · all named"}.
                </p>
              )}
              {p.bouquets.length === 0 ? (
                <Empty title="No bouquets loaded yet">Click “Sync bouquets”.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Bouquet name</th></tr></thead>
                    <tbody>
                      {p.bouquets.map((b) => (
                        <tr key={b.id}>
                          <td className="font-medium">
                            <form action={renameBouquetAction} className="flex items-center gap-2">
                              <input type="hidden" name="id" value={b.id} />
                              <input className="input min-w-48 py-1 text-sm" name="name" defaultValue={isPlaceholderBouquetName(b.name) ? "" : b.name} placeholder={`no name (#${b.externalId})`} aria-label="Bouquet name" required maxLength={100} />
                              <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                              {latest && b.syncedAt < latest && <span className="badge-red">removed on panel</span>}
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
