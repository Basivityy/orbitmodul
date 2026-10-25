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
      bouquets: { include: { packages: { include: { package: { select: { id: true, name: true, active: true } } } } } },
      packages: { select: { id: true } },
    },
  });
  // Named bouquets first (A–Z, numbers in natural order), unnamed "Bouquet #id" ones after them.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  for (const p of panels) p.bouquets.sort((a, b) => Number(isPlaceholderBouquetName(a.name) || !a.name.trim()) - Number(isPlaceholderBouquetName(b.name) || !b.name.trim()) || collator.compare(a.name, b.name));
  return (
    <>
      <PageHeader title="Bouquet management" description="Bouquets are loaded from your own XUI One panel through its API. You can rename them here (names show in your store). Choose which bouquets each package includes on the package page." />
      <Flash sp={sp} />
      {panels.length === 0 && (
        <Card><Empty title="No panel connected">Connect your panel on the <Link href="/dashboard/panels">XUI One panels</Link> page first.</Empty></Card>
      )}
      <div className="space-y-6">
        {panels.map((p) => {
          const latest = p.bouquets.reduce<Date | null>((m, b) => (!m || b.syncedAt > m ? b.syncedAt : m), null);
          const unnamed = p.bouquets.filter((b) => isPlaceholderBouquetName(b.name) || !b.name.trim()).length;
          const pkgCount = p.packages.length;
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
                    <thead><tr><th>Bouquet name</th><th>Panel ID</th><th>Used in packages</th></tr></thead>
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
                          <td className="muted">{b.externalId}</td>
                          <td className="text-sm">
                            {b.packages.length === 0 ? (
                              <span className="muted">—</span>
                            ) : b.packages.length === pkgCount && pkgCount > 1 ? (
                              <span className="badge-green">all packages ({pkgCount})</span>
                            ) : (
                              <span className="flex flex-wrap gap-1.5">
                                {b.packages.slice(0, 3).map((pb) => (
                                  <Link key={pb.package.id} href={`/dashboard/packages/${pb.package.id}`} className={`${pb.package.active ? "badge-blue" : "badge-gray"} no-underline`}>{pb.package.name}</Link>
                                ))}
                                {b.packages.length > 3 && <span className="badge-gray" title={b.packages.slice(3).map((pb) => pb.package.name).join(", ")}>+{b.packages.length - 3} more</span>}
                              </span>
                            )}
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
