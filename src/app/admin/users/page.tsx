import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Card, DateTime, Empty, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "All accounts" };
export const dynamic = "force-dynamic";
const PER = 50;
const FILTERS = ["RESELLER", "ADMINS"] as const;
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: "super admin", ADMIN: "admin", RESELLER: "reseller" };

/** Every login account on the platform (admins and reseller owners) — read-only overview. */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const role = FILTERS.find((r) => r === sp.role);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.UserWhereInput = {};
  if (role === "RESELLER") where.role = "RESELLER";
  if (role === "ADMINS") where.role = { in: ["SUPER_ADMIN", "ADMIN"] };
  if (q) where.OR = [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { reseller: { storeName: { contains: q, mode: "insensitive" } } }];
  const [rows, byRole] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        reseller: {
          select: {
            id: true,
            storeName: true,
            status: true,
            approvalStatus: true,
            _count: { select: { customers: true, subscriptions: { where: { status: "ACTIVE", isTest: false } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER,
      take: PER + 1,
    }),
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);
  const n = (r: string) => byRole.find((b) => b.role === r)?._count._all ?? 0;
  const all = byRole.reduce((a, b) => a + b._count._all, 0);
  const tabs = [
    { label: `All (${all})`, href: "/admin/users", active: !role },
    { label: `Resellers (${n("RESELLER")})`, href: "/admin/users?role=RESELLER", active: role === "RESELLER" },
    { label: `Admins (${n("ADMIN") + n("SUPER_ADMIN")})`, href: "/admin/users?role=ADMINS", active: role === "ADMINS" },
  ];
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}) }).toString();

  return (
    <>
      <PageHeader title="All accounts" description="Every login on the platform: administrators and reseller owners, with their store, customers and active lines." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => <Link key={t.href} href={t.href} className={t.active ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{t.label}</Link>)}
        <form className="ml-auto flex gap-2">
          {role && <input type="hidden" name="role" value={role} />}
          <input className="input" name="q" defaultValue={q} placeholder="Email, name or store" />
          <button className="btn-secondary">Search</button>
        </form>
      </div>
      <Card pad={false}>
        {rows.length === 0 ? <Empty title="No accounts found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Account</th><th>Role</th><th>Store</th><th>Customers</th><th>Active lines</th><th>Security</th><th>Last login</th><th>Created</th></tr></thead>
              <tbody>
                {rows.slice(0, PER).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-medium">{u.email}</div>
                      <div className="muted text-xs">{u.name}{u.status !== "ACTIVE" ? " · " : ""}{u.status !== "ACTIVE" && <StatusBadge status={u.status} />}</div>
                    </td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td>
                      {u.reseller ? (
                        <>
                          <Link href={`/admin/resellers/${u.reseller.id}`}>{u.reseller.storeName}</Link>
                          <div className="mt-0.5 flex gap-1">
                            {u.reseller.approvalStatus !== "APPROVED" && <StatusBadge status={u.reseller.approvalStatus} />}
                            {u.reseller.status !== "ACTIVE" && <StatusBadge status={u.reseller.status} />}
                          </div>
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="tabular-nums">{u.reseller ? <Link href={`/admin/customers?reseller=${u.reseller.id}&test=show`}>{u.reseller._count.customers}</Link> : "—"}</td>
                    <td className="tabular-nums">{u.reseller ? <Link href={`/admin/customers?reseller=${u.reseller.id}&status=ACTIVE`}>{u.reseller._count.subscriptions}</Link> : "—"}</td>
                    <td className="text-xs">{u.totpEnabled ? "✓ 2FA" : <span className="muted">no 2FA</span>}<div className={u.emailVerifiedAt ? "" : "text-amber-600"}>{u.emailVerifiedAt ? "✓ email" : "email not confirmed"}</div></td>
                    <td><DateTime value={u.lastLoginAt} /></td>
                    <td><DateTime value={u.createdAt} dateOnly /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} hasMore={rows.length > PER} baseHref={`/admin/users${qs ? `?${qs}` : ""}`} />
      </Card>
    </>
  );
}
