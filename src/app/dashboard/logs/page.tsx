import Link from "next/link";
import { Card, DateTime, Empty, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "API logs" };
const PER = 100;

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const onlyErrors = sp.errors === "1";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const rows = await db.apiLog.findMany({ where: { resellerId: reseller.id, ...(onlyErrors ? { success: false } : {}) }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 });
  return (
    <>
      <PageHeader title="API logs" description="Calls made to your XUI One panel, MaxPlayer and payment providers. API keys are never logged." actions={<Link className="btn-secondary" href={onlyErrors ? "/dashboard/logs" : "/dashboard/logs?errors=1"}>{onlyErrors ? "Show all" : "Errors only"}</Link>} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No log entries" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Service</th><th>Action</th><th>Result</th><th>HTTP</th><th>Duration</th><th>Message</th></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((l) => (
                  <tr key={l.id}>
                    <td><DateTime value={l.createdAt} /></td>
                    <td>{l.service}</td>
                    <td className="font-mono text-xs">{l.action}</td>
                    <td>{l.success ? <span className="badge-green">ok</span> : <span className="badge-red">error</span>}</td>
                    <td>{l.statusCode ?? "—"}</td>
                    <td>{l.durationMs != null ? `${l.durationMs} ms` : "—"}</td>
                    <td className="max-w-md whitespace-normal text-xs">{l.message}{l.orderId && <> · <Link href={`/dashboard/orders/${l.orderId}`}>order</Link></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/dashboard/logs?errors=${onlyErrors ? 1 : 0}`} />
      </Card>
    </>
  );
}
