import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayCustomer } from "@/core/importedCustomers";
import { deleteCustomerAction } from "../actions/customers";

export const metadata = { title: "Customers" };
const PER = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = { resellerId: reseller.id, ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : {}) };
  const rows = await db.customer.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PER,
    take: PER + 1,
    include: { subscriptions: { where: { status: "ACTIVE" }, select: { id: true, expiresAt: true } }, _count: { select: { orders: true } } },
  });
  return (
    <>
      <PageHeader title="Customers" description="Only your own customers are listed here." actions={<><Link className="btn-secondary" href="/dashboard/customers/existing">Load existing line</Link><Link className="btn-primary" href="/dashboard/customers/new">+ Add customer</Link></>} />
      <form className="mb-4 flex gap-2">
        <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Search email or name" />
        <button className="btn-secondary">Search</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No customers found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Active subscriptions</th><th>Next expiry</th><th>Orders</th><th>Since</th><th></th></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((c) => {
                  const next = c.subscriptions.map((s) => s.expiresAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/dashboard/customers/${c.id}`} className="font-medium">{displayCustomer(c.email)}</Link>{c.name && <div className="muted text-xs">{c.name}</div>}</td>
                      <td>{c.subscriptions.length}</td>
                      <td><DateTime value={next} dateOnly /></td>
                      <td>{c._count.orders}</td>
                      <td><DateTime value={c.createdAt} dateOnly /></td>
                      <td className="text-right">
                        <form action={deleteCustomerAction}>
                          <input type="hidden" name="customerId" value={c.id} />
                          <input type="hidden" name="removeRemote" value="on" />
                          <SubmitButton className="text-xs text-rose-600 hover:underline" confirm={`Delete ${displayCustomer(c.email)}? The customer's line on the XUI panel and the MaxPlayer account are deleted too. This cannot be undone.`}>Delete</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/dashboard/customers?q=${encodeURIComponent(q)}`} />
      </Card>
    </>
  );
}
