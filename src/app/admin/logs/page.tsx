import { Card, DateTime, PageHeader, Pagination } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "System errors" };
const PER = 100;

export default async function AdminLogs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const [rows, webhookErrors, emailErrors] = await Promise.all([
    db.apiLog.findMany({ where: { success: false }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER + 1 }),
    db.webhookEvent.findMany({ where: { error: { not: null } }, orderBy: { receivedAt: "desc" }, take: 30 }),
    db.emailLog.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const resellerIds = Array.from(new Set(rows.map((r) => r.resellerId).filter(Boolean))) as string[];
  const names = new Map((await db.reseller.findMany({ where: { id: { in: resellerIds } }, select: { id: true, storeName: true } })).map((r) => [r.id, r.storeName]));
  return (
    <>
      <PageHeader title="System errors" description="API failures across all resellers (XUI, MaxPlayer, payment providers, webhooks) and email delivery errors." />
      <Card title="API errors" pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Reseller</th><th>Service</th><th>Action</th><th>HTTP</th><th>Message</th></tr></thead>
            <tbody>
              {rows.slice(0, PER).map((l) => (
                <tr key={l.id}><td><DateTime value={l.createdAt} /></td><td>{l.resellerId ? names.get(l.resellerId) ?? "—" : "platform"}</td><td>{l.service}</td><td className="font-mono text-xs">{l.action}</td><td>{l.statusCode ?? "—"}</td><td className="max-w-lg whitespace-normal text-xs">{l.message}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} hasMore={rows.length > PER} baseHref="/admin/logs" />
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Webhook processing errors" pad={false}>
          <div className="table-wrap"><table className="table"><tbody>
            {webhookErrors.map((w) => <tr key={w.id}><td><DateTime value={w.receivedAt} /></td><td>{w.provider}</td><td className="text-xs">{w.type}</td><td className="max-w-xs whitespace-normal text-xs text-rose-600">{w.error}</td></tr>)}
            {webhookErrors.length === 0 && <tr><td className="muted">None</td></tr>}
          </tbody></table></div>
        </Card>
        <Card title="Email delivery errors" pad={false}>
          <div className="table-wrap"><table className="table"><tbody>
            {emailErrors.map((e) => <tr key={e.id}><td><DateTime value={e.createdAt} /></td><td>{e.to}</td><td className="text-xs">{e.template}</td><td className="max-w-xs whitespace-normal text-xs text-rose-600">{e.error}</td></tr>)}
            {emailErrors.length === 0 && <tr><td className="muted">None</td></tr>}
          </tbody></table></div>
        </Card>
      </div>
    </>
  );
}
