import { Card, DateTime, PageHeader, Pagination } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Audit log" };
const PER = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const rows = await db.auditLog.findMany({
    where: { ...(sp.reseller ? { resellerId: sp.reseller } : {}), ...(q ? { OR: [{ action: { contains: q } }, { actorEmail: { contains: q, mode: "insensitive" } }, { target: { contains: q } }] } : {}) },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PER,
    take: PER + 1,
  });
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of security-relevant actions by resellers, administrators and the system." />
      <form className="mb-4 flex gap-2"><input className="input max-w-sm" name="q" defaultValue={q} placeholder="Action, email or target" /><button className="btn-secondary">Filter</button></form>
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>IP</th><th>Details</th></tr></thead>
            <tbody>
              {rows.slice(0, PER).map((a) => (
                <tr key={a.id}>
                  <td><DateTime value={a.createdAt} /></td>
                  <td className="text-xs">{a.actorEmail ?? "system"}<div className="muted">{a.actorRole?.toLowerCase()}</div></td>
                  <td className="font-mono text-xs">{a.action}</td>
                  <td className="text-xs">{a.target}</td>
                  <td className="text-xs">{a.ip}</td>
                  <td className="max-w-xs truncate text-xs" title={a.meta ? JSON.stringify(a.meta) : ""}>{a.meta ? JSON.stringify(a.meta) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/admin/audit?q=${encodeURIComponent(q)}${sp.reseller ? `&reseller=${sp.reseller}` : ""}`} />
      </Card>
    </>
  );
}
