import { effectivePrice } from "@/core/pricing";
import { inkFor } from "@/core/color";
import { packageSellable } from "@/core/catalog";
import { Money } from "@/components/ui";
import { EmbedResize } from "@/components/EmbedResize";
import { packageBouquetNames } from "@/lib/bouquetCatalog";
import { db } from "@/lib/db";
import { resolveStore } from "@/lib/storefront";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store", robots: { index: false, follow: false } };

function durationLabel(days: number) {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0) return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

/**
 * Widget for the reseller's own website (iframe, see /widget.js): packages with "Buy", plus
 * "Extend" and "Activate a code". Buttons open the secure store pages in the main window.
 */
export default async function EmbedPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { reseller, absoluteBase, canSell } = await resolveStore(slug);
  const target = sp.target === "blank" ? "_blank" : "_top";
  const light = sp.theme === "light";
  const style = { "--brand": reseller.primaryColor, "--brand-ink": inkFor(reseller.primaryColor), background: "transparent" } as React.CSSProperties;
  const shell = (children: React.ReactNode) => (
    <div style={style} className="p-3 sm:p-4">
      {/* Theme of the host page: light or dark (default dark). Static string, no user input. */}
      {light && <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.remove('dark')" }} />}
      <EmbedResize />
      {children}
    </div>
  );
  if (!reseller.partnerApiEnabled) return shell(<p className="muted text-center text-sm">This store widget is not available.</p>);
  const packages = (
    await db.package.findMany({
      where: { resellerId: reseller.id, active: true },
      orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
      include: { panel: { select: { apiUrl: true } }, bouquets: { include: { bouquet: { select: { name: true, externalId: true } } } } },
    })
  ).filter(packageSellable);
  const names = await Promise.all(packages.map((p) => packageBouquetNames(p.panel.apiUrl, p.bouquets.map((b) => b.bouquet))));
  return shell(
    <>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <a href={`${absoluteBase}/renew`} target={target} rel="noopener" className="btn-secondary w-full">Extend my line</a>
        <a href={`${absoluteBase}/activate`} target={target} rel="noopener" className="btn-secondary w-full">I have a code</a>
      </div>
      {!canSell ? (
        <p className="muted text-center text-sm">Not accepting new orders at the moment.</p>
      ) : packages.length === 0 ? (
        <p className="muted text-center text-sm">No packages available yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p, i) => {
            const price = effectivePrice(p);
            return (
              <div key={p.id} className="card flex flex-col overflow-hidden">
                <div className="h-1" style={{ background: "var(--brand)" }} />
                <div className="flex flex-1 flex-col p-4">
                  <div className="font-bold">{p.name}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold" style={{ color: "var(--brand)" }}><Money amount={price.amount} currency={p.currency} /></span>
                    {price.isPromo && <span className="muted text-sm line-through"><Money amount={p.priceCents} currency={p.currency} /></span>}
                  </div>
                  <div className="muted text-sm">{durationLabel(p.durationDays)} · {p.maxConnections} connection{p.maxConnections > 1 ? "s" : ""}</div>
                  <ul className="mt-2 flex-1 space-y-0.5 text-sm">
                    {names[i].names.slice(0, 4).map((n, j) => <li key={j}>✓ {n}</li>)}
                    {names[i].names.length + names[i].unnamed > 4 && <li className="muted">+ {names[i].names.length + names[i].unnamed - Math.min(4, names[i].names.length)} more</li>}
                  </ul>
                  <a href={`${absoluteBase}/checkout/${p.id}`} target={target} rel="noopener" className="btn mt-3 w-full" style={{ background: "var(--brand)", color: "var(--brand-ink)" }}>Buy</a>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted mt-3 text-center text-xs">Secure checkout by {reseller.storeName}</p>
    </>,
  );
}
