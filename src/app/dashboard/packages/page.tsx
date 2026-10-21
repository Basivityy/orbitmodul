import Link from "next/link";
import { effectivePrice } from "@/core/pricing";
import { SubmitButton } from "@/components/client";
import { Card, Empty, Flash, Money, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { packageBouquetNames } from "@/lib/bouquetCatalog";
import { togglePackageAction } from "../actions/packages";
import { importPanelPackagesAction } from "../actions/panels";

export const metadata = { title: "Packages & prices" };

export default async function PackagesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const panels = await db.panelIntegration.findMany({ where: { resellerId: reseller.id }, select: { id: true, name: true } });
  const packages = await db.package.findMany({
    where: { resellerId: reseller.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { bouquets: { include: { bouquet: true } }, panel: true, _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } },
  });
  const bouquetNames = await Promise.all(packages.map((p) => packageBouquetNames(p.panel.apiUrl, p.bouquets.map((b) => b.bouquet))));
  return (
    <>
      <PageHeader
        title="Packages & prices"
        description="You decide every price. Changes apply to new purchases immediately; already paid periods are never changed."
        actions={
          <>
            {panels.map((pn) => (
              <form key={pn.id} action={importPanelPackagesAction}>
                <input type="hidden" name="id" value={pn.id} />
                <SubmitButton className="btn-secondary">Import packages from {pn.name}</SubmitButton>
              </form>
            ))}
            <Link className="btn-primary" href="/dashboard/packages/new">New package</Link>
          </>
        }
      />
      <Flash sp={sp} />
      <Card pad={false}>
        {packages.length === 0 ? (
          <Empty title="No packages yet">Create your first package — choose bouquets, duration and your own price.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Package</th><th>Price</th><th>Duration</th><th>Bouquets</th><th>Billing</th><th>Active subs</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {packages.map((p, i) => {
                  const price = effectivePrice(p);
                  const bq = bouquetNames[i];
                  return (
                    <tr key={p.id}>
                      <td className="font-medium"><Link href={`/dashboard/packages/${p.id}`}>{p.name}</Link><div className="muted text-xs">{p.panel.name}{p.externalPackageId ? ` · XUI package #${p.externalPackageId}` : ""}{p.maxPlayerEnabled ? " · MaxPlayer" : ""}{p.priceCents === 0 && !p.active ? " · set your price" : ""}</div></td>
                      <td>
                        <Money amount={price.amount} currency={p.currency} />
                        {price.isPromo && <span className="muted ml-1 text-xs line-through"><Money amount={p.priceCents} currency={p.currency} /></span>}
                      </td>
                      <td>{p.durationDays} days · {p.maxConnections} conn.</td>
                      <td className="max-w-xs truncate whitespace-normal text-xs">{[...bq.names, ...(bq.unnamed ? [`${bq.unnamed} unnamed (#ids)`] : [])].join(", ")}</td>
                      <td>{p.billingType === "RECURRING" ? <span className="badge-blue">auto-renew</span> : <span className="badge-gray">one-time</span>}</td>
                      <td>{p._count.subscriptions}</td>
                      <td>{p.active ? <span className="badge-green">on sale</span> : <span className="badge-gray">hidden</span>}</td>
                      <td className="text-right">
                        <form action={togglePackageAction} className="inline">
                          <input type="hidden" name="id" value={p.id} />
                          <SubmitButton className="btn-ghost btn-sm">{p.active ? "Deactivate" : "Activate"}</SubmitButton>
                        </form>
                        <Link className="btn-secondary btn-sm ml-1" href={`/dashboard/packages/${p.id}`}>Edit</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
