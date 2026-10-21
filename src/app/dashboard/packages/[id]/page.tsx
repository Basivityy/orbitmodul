import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Card, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadResellerSaas, planLimits } from "@/lib/saas";
import { storeBaseUrl } from "@/lib/urls";
import { deletePackageAction } from "../../actions/packages";
import { testPurchaseAction } from "../../actions/orders";
import { PackageForm } from "../PackageForm";
import { loadPanelPackageOptions } from "@/lib/panelPackages";

export const metadata = { title: "Edit package" };

export default async function EditPackagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { user, reseller } = await requireReseller();
  const pkg = await db.package.findFirst({ where: { id, resellerId: reseller.id }, include: { bouquets: true } });
  if (!pkg) notFound();
  const [panels, limits, testGw] = await Promise.all([
    db.panelIntegration.findMany({ where: { resellerId: reseller.id }, include: { bouquets: { orderBy: { name: "asc" } } } }),
    loadResellerSaas(reseller.id).then(planLimits),
    db.paymentGateway.findUnique({ where: { resellerId_provider: { resellerId: reseller.id, provider: "TEST" } } }),
  ]);
  return (
    <>
      <PageHeader
        title={pkg.name}
        description={<a href={`${storeBaseUrl(reseller)}/checkout/${pkg.id}`} target="_blank" rel="noreferrer">Direct payment link ↗</a>}
      />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Package" className="lg:col-span-2">
          <PackageForm pkg={pkg} selected={pkg.bouquets.map((b) => b.bouquetId)} panels={panels} defaultCurrency={reseller.defaultCurrency} allowMaxPlayer={limits.allowMaxPlayer} panelPackages={await loadPanelPackageOptions(reseller.id, panels)} />
        </Card>
        <div className="space-y-6">
          <Card title="Test purchase" description="Runs the full flow — order, payment confirmation, line activation, email — with the built-in test gateway.">
            {testGw?.enabled ? (
              <form action={testPurchaseAction} className="space-y-3">
                <input type="hidden" name="packageId" value={pkg.id} />
                <input className="input" name="email" type="email" placeholder={user.email} />
                <SubmitButton className="btn-secondary w-full">Start test purchase</SubmitButton>
                <p className="hint">If the panel is in test mode, no real line is created.</p>
              </form>
            ) : (
              <p className="muted">Enable the “Test gateway” on the Payment gateways page to use this.</p>
            )}
          </Card>
          <Card title="Payment link">
            <p className="muted mb-2">Send this link to customers to buy this package directly:</p>
            <code className="block break-all text-xs">{storeBaseUrl(reseller)}/checkout/{pkg.id}</code>
          </Card>
          <Card title="Danger zone">
            <form action={deletePackageAction}>
              <input type="hidden" name="id" value={pkg.id} />
              <SubmitButton className="btn-danger" confirm="Delete this package?">Delete package</SubmitButton>
            </form>
            <p className="hint mt-2">Packages with orders can only be deactivated.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
