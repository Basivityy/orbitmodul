import { Card, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadResellerSaas, planLimits } from "@/lib/saas";
import { PackageForm } from "../PackageForm";
import { loadPanelPackageOptions } from "@/lib/panelPackages";

export const metadata = { title: "New package" };

export default async function NewPackagePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const panels = await db.panelIntegration.findMany({ where: { resellerId: reseller.id }, include: { bouquets: { orderBy: { name: "asc" } } } });
  const limits = planLimits(await loadResellerSaas(reseller.id));
  // MaxPlayer connected and enabled → new packages create MaxPlayer accounts by default.
  const mp = await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id }, select: { enabled: true } });
  return (
    <>
      <PageHeader title="New package" description="Name, price, currency, duration and bouquets are entirely up to you." />
      <Flash sp={sp} />
      <Card>
        <PackageForm selected={[]} panels={panels} defaultCurrency={reseller.defaultCurrency} allowMaxPlayer={limits.allowMaxPlayer} maxPlayerDefault={limits.allowMaxPlayer && !!mp?.enabled} panelPackages={await loadPanelPackageOptions(reseller.id, panels)} />
      </Card>
    </>
  );
}
