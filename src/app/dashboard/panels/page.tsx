import Link from "next/link";
import { Card, DateTime, Empty, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { PanelForm } from "./PanelForm";

export const metadata = { title: "XUI One panels" };

export default async function PanelsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const panels = await db.panelIntegration.findMany({ where: { resellerId: reseller.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { bouquets: true, packages: true } } } });
  return (
    <>
      <PageHeader title="XUI One panels" description="Connect the reseller API of your XUI One panel. Lines are created on this panel automatically after each payment." />
      <Flash sp={sp} />
      <Card title="Connected panels" pad={false} className="mb-6">
        {panels.length === 0 ? (
          <Empty title="No panel connected yet">Add your panel below.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Status</th><th>Mode</th><th>Credits</th><th>Bouquets</th><th>Packages</th><th>Last check</th><th /></tr>
              </thead>
              <tbody>
                {panels.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name}<div className="muted text-xs">{p.apiUrl}</div></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{p.testMode ? <span className="badge-amber">test</span> : <span className="badge-green">live</span>}</td>
                    <td>{p.credits ?? "—"}</td>
                    <td>{p._count.bouquets}</td>
                    <td>{p._count.packages}</td>
                    <td><DateTime value={p.lastCheckedAt} /></td>
                    <td className="text-right"><Link className="btn-secondary btn-sm" href={`/dashboard/panels/${p.id}`}>Manage</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Add a panel">
        <PanelForm />
      </Card>
    </>
  );
}
