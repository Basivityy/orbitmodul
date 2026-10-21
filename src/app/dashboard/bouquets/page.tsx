import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { renameBouquetAction, syncBouquetsAction } from "../actions/panels";

export const metadata = { title: "Bouquet management" };

export default async function BouquetsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const panels = await db.panelIntegration.findMany({
    where: { resellerId: reseller.id },
    include: { bouquets: { orderBy: { name: "asc" }, include: { packages: { include: { package: { select: { id: true, name: true, active: true } } } } } } },
  });
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
              {p.bouquets.length === 0 ? (
                <Empty title="No bouquets loaded yet">Click “Sync bouquets”.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Bouquet</th><th>Panel ID</th><th>Used in packages</th></tr></thead>
                    <tbody>
                      {p.bouquets.map((b) => (
                        <tr key={b.id}>
                          <td className="font-medium">
                            <form action={renameBouquetAction} className="flex items-center gap-2">
                              <input type="hidden" name="id" value={b.id} />
                              <input className="input py-1 text-sm" name="name" defaultValue={b.name} aria-label="Bouquet name" />
                              <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                              {latest && b.syncedAt < latest && <span className="badge-red">removed on panel</span>}
                            </form>
                          </td>
                          <td className="muted">{b.externalId}</td>
                          <td className="whitespace-normal">
                            {b.packages.length === 0 ? <span className="muted">—</span> : b.packages.map((pb) => (
                              <Link key={pb.package.id} href={`/dashboard/packages/${pb.package.id}`} className={`mr-2 ${pb.package.active ? "badge-blue" : "badge-gray"} no-underline`}>{pb.package.name}</Link>
                            ))}
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
