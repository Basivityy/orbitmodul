import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { saasActive } from "@/lib/saas";
import { resellerPlansEnabled } from "@/lib/settings";
import { approveResellerAction, rejectResellerAction } from "../actions";

export const metadata = { title: "Resellers" };
const PER = 50;
const APPROVAL = ["PENDING", "APPROVED", "REJECTED"] as const;

export default async function ResellersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const approval = APPROVAL.find((a) => a === sp.approval);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.ResellerWhereInput = {};
  if (q) where.OR = [{ storeName: { contains: q, mode: "insensitive" } }, { slug: { contains: q } }, { owner: { email: { contains: q, mode: "insensitive" } } }];
  if (approval) where.approvalStatus = approval;
  const [rows, counts, plansOn, waiting] = await Promise.all([
    db.reseller.findMany({
      where,
      include: { owner: true, saas: { include: { plan: true } }, _count: { select: { subscriptions: { where: { status: "ACTIVE" } }, packages: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER,
      take: PER + 1,
    }),
    db.reseller.groupBy({ by: ["approvalStatus"], _count: { _all: true } }),
    resellerPlansEnabled(),
    approval ? Promise.resolve([]) : db.reseller.findMany({ where: { approvalStatus: "PENDING" }, include: { owner: true }, orderBy: { createdAt: "asc" }, take: 20 }),
  ]);
  const count = (s: string) => counts.find((c) => c.approvalStatus === s)?._count._all ?? 0;
  const back = `/admin/resellers${approval ? `?approval=${approval}` : ""}`;
  const tabs = [
    { label: "All", href: "/admin/resellers", active: !approval },
    { label: `Waiting for approval (${count("PENDING")})`, href: "/admin/resellers?approval=PENDING", active: approval === "PENDING" },
    { label: `Approved (${count("APPROVED")})`, href: "/admin/resellers?approval=APPROVED", active: approval === "APPROVED" },
    { label: `Declined (${count("REJECTED")})`, href: "/admin/resellers?approval=REJECTED", active: approval === "REJECTED" },
  ];
  const pendingList = approval === "PENDING" ? rows.slice(0, PER) : waiting;

  return (
    <>
      <PageHeader title="Resellers" description="New resellers can only use the platform after you approve them." />
      <Flash sp={sp} />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={t.active ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{t.label}</Link>
        ))}
      </div>

      {pendingList.length > 0 && (
        <Card title="Waiting for approval" description="Approve to give them access. They get an email either way." className="mb-6" pad={false}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {pendingList.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <Link href={`/admin/resellers/${r.id}`} className="font-semibold">{r.storeName}</Link>
                  <div className="muted text-sm">
                    {r.owner.name} · {r.owner.email} {r.owner.emailVerifiedAt ? <span className="badge-green">email confirmed</span> : <span className="badge-amber">email not confirmed</span>}
                  </div>
                  <div className="muted text-xs">Registered <DateTime value={r.createdAt} /> · /{r.slug}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={approveResellerAction}>
                    <input type="hidden" name="resellerId" value={r.id} />
                    <input type="hidden" name="back" value={back} />
                    <SubmitButton className="btn-primary btn-sm">✓ Approve</SubmitButton>
                  </form>
                  <form action={rejectResellerAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="resellerId" value={r.id} />
                    <input type="hidden" name="back" value={back} />
                    <input className="input h-8 w-48 text-sm" name="reason" placeholder="Reason (optional, sent to them)" maxLength={500} />
                    <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm={`Decline ${r.storeName}?`}>✕ Decline</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {approval !== "PENDING" && (
        <>
          <form className="mb-4 flex gap-2">
            {approval && <input type="hidden" name="approval" value={approval} />}
            <input className="input max-w-sm" name="q" defaultValue={q} placeholder="Store, address or owner email" />
            <button className="btn-secondary">Search</button>
          </form>
          <Card pad={false}>
            {rows.length === 0 ? <Empty title="No resellers" /> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Store</th><th>Owner</th><th>Approval</th><th>Status</th><th>Billing</th>{plansOn && <th>Plan</th>}<th>Active subs</th><th>Joined</th></tr></thead>
                  <tbody>
                    {rows.slice(0, PER).map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/admin/resellers/${r.id}`} className="font-medium">{r.storeName}</Link><div className="muted text-xs">/{r.slug}{r.customDomain ? ` · ${r.customDomain}` : ""}</div></td>
                        <td>{r.owner.email}{!r.owner.emailVerifiedAt && <span className="badge-amber ml-1">unverified</span>}</td>
                        <td><StatusBadge status={r.approvalStatus} label={r.approvalStatus === "PENDING" ? "waiting" : r.approvalStatus === "REJECTED" ? "declined" : "approved"} /></td>
                        <td><StatusBadge status={r.status} /></td>
                        <td>{r.billingEnabled ? <span className="badge-green">on</span> : <span className="badge-red">off</span>}</td>
                        {plansOn && <td>{r.saas ? <>{r.saas.plan.name} <StatusBadge status={saasActive(r.saas) ? r.saas.status : "EXPIRED"} /></> : "—"}</td>}
                        <td>{r._count.subscriptions}</td>
                        <td><DateTime value={r.createdAt} dateOnly /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} hasMore={rows.length > PER} baseHref={`/admin/resellers?q=${encodeURIComponent(q)}${approval ? `&approval=${approval}` : ""}`} />
          </Card>
        </>
      )}
      {approval === "PENDING" && pendingList.length === 0 && <Card><Empty title="Nobody is waiting for approval">New registrations appear here.</Empty></Card>}
    </>
  );
}
