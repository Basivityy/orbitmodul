import Link from "next/link";
import { effectivePrice } from "@/core/pricing";
import { Money } from "@/components/ui";
import { db } from "@/lib/db";
import { resolveStore } from "@/lib/storefront";
import { packageBouquetNames } from "@/lib/bouquetCatalog";
import { packageSellable } from "@/core/catalog";

function durationLabel(days: number) {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0) return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

export default async function StoreHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { reseller, base, canSell } = await resolveStore(slug);
  const packages = (await db.package.findMany({
    where: { resellerId: reseller.id, active: true },
    orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
    include: { panel: { select: { apiUrl: true } }, bouquets: { include: { bouquet: { select: { name: true, externalId: true } } } } },
  })).filter(packageSellable); // never take money for a package the panel cannot activate
  const bouquetNames = await Promise.all(packages.map((p) => packageBouquetNames(p.panel.apiUrl, p.bouquets.map((b) => b.bouquet))));
  return (
    <>
      <section className="mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl">{reseller.storeName}</h1>
        {reseller.description && <p className="muted mx-auto mt-3 max-w-2xl whitespace-pre-line text-base">{reseller.description}</p>}
        <div className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
          <a href="#packages" className="btn flex-1 py-3 text-white" style={{ background: "var(--brand)" }}>Buy a new line</a>
          <Link href={`${base}/renew`} className="btn-secondary flex-1 py-3">Extend my line</Link>
        </div>
        {sp.canceled && <p className="mx-auto mt-4 max-w-md rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Payment was canceled. You can try again any time.</p>}
      </section>
      {!canSell && <p className="mx-auto mb-8 max-w-lg rounded-lg bg-slate-100 px-4 py-3 text-center text-sm dark:bg-slate-800">This store is not accepting new orders at the moment. Existing subscriptions are not affected.</p>}
      {packages.length === 0 ? (
        <p className="muted text-center">No packages available yet.</p>
      ) : (
        <div id="packages" className="grid scroll-mt-6 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p, i) => {
            const price = effectivePrice(p);
            const { names, unnamed } = bouquetNames[i];
            return (
              <div key={p.id} className="card flex flex-col overflow-hidden">
                <div className="h-1.5" style={{ background: "var(--brand)" }} />
                <div className="flex flex-1 flex-col p-6">
                  <h2 className="text-xl">{p.name}</h2>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold" style={{ color: "var(--brand)" }}><Money amount={price.amount} currency={p.currency} /></span>
                    {price.isPromo && <span className="muted line-through"><Money amount={p.priceCents} currency={p.currency} /></span>}
                  </div>
                  <p className="muted mt-1">{durationLabel(p.durationDays)}{p.billingType === "RECURRING" ? " · renews automatically" : ""}</p>
                  {p.description && <p className="mt-4 whitespace-pre-line text-sm">{p.description}</p>}
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                    <li>✓ {p.maxConnections} simultaneous connection{p.maxConnections > 1 ? "s" : ""}</li>
                    {names.slice(0, 8).map((n, j) => <li key={j}>✓ {n}</li>)}
                    {names.length > 8 && <li className="muted">+ {names.length - 8} more</li>}
                    {unnamed > 0 && <li className="muted">✓ {names.length ? `+ ${unnamed} more` : `${unnamed}`} channel group{unnamed > 1 ? "s" : ""}</li>}
                    {p.maxPlayerEnabled && <li>✓ MaxPlayer app account included</li>}
                    <li>✓ Instant activation after payment</li>
                  </ul>
                  {canSell ? (
                    <>
                      <Link href={`${base}/checkout/${p.id}`} className="btn mt-6 text-white" style={{ background: "var(--brand)" }}>Buy new line</Link>
                      <Link href={`${base}/renew`} className="mt-2 text-center text-sm">or extend my existing line</Link>
                    </>
                  ) : (
                    <span className="btn-secondary mt-6 pointer-events-none opacity-60">Unavailable</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
