import Link from "next/link";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { displayCustomer, isPlaceholderEmail } from "@/core/importedCustomers";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { adminRetryMaxPlayerAction } from "../../actions";

export const metadata = { title: "Customer line" };
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <span className="muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/** Admin view of one line: who owns it, its customer, orders and MaxPlayer state. No passwords shown. */
export default async function AdminCustomerLinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const s = await db.subscription.findUnique({
    where: { id },
    include: {
      customer: true,
      package: true,
      panel: { select: { name: true, testMode: true } },
      reseller: { include: { owner: { select: { email: true, name: true, lastLoginAt: true } }, maxPlayer: { select: { enabled: true, testMode: true } } } },
      orders: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!s) notFound();
  const otherLines = await db.subscription.findMany({ where: { customerId: s.customerId, NOT: { id: s.id } }, select: { id: true, lineUsername: true, status: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 20 });
  const simulated = (s.maxPlayerUserId ?? "").startsWith("TEST-");
  const canRetryMp = !s.isTest && !!s.lineUsername && !!s.reseller.maxPlayer?.enabled && (s.maxPlayerStatus === "FAILED" || s.maxPlayerStatus === "PENDING" || simulated || s.maxPlayerStatus === "NONE");

  return (
    <>
      <PageHeader
        title={s.lineUsername ?? "Line"}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={s.status} />{s.isTest && <span className="badge-amber">test line</span>} owner: <Link href={`/admin/resellers/${s.resellerId}`}>{s.reseller.storeName}</Link></span>}
        actions={<Link className="btn-secondary" href={`/admin/customers?reseller=${s.resellerId}`}>All lines of this reseller</Link>}
      />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Line">
          <Row label="Username"><span className="font-mono">{s.lineUsername ?? "—"}</span></Row>
          <Row label="Status"><StatusBadge status={s.status} /></Row>
          <Row label="Expires"><DateTime value={s.expiresAt} /></Row>
          <Row label="Started"><DateTime value={s.startsAt} /></Row>
          <Row label="Package">{s.package.name} · {s.durationDays === 1 ? "1 day" : `${s.durationDays} days`}</Row>
          <Row label="Panel">{s.panel.name}{s.panel.testMode ? " (test mode)" : ""}</Row>
          <Row label="XUI line id"><span className="font-mono">{s.xuiLineId ?? "—"}</span></Row>
          <Row label="Price"><Money amount={s.priceCents} currency={s.currency} /></Row>
          <Row label="Created"><DateTime value={s.createdAt} /></Row>
        </Card>
        <div className="space-y-6">
          <Card title="Owner (reseller)">
            <Row label="Store"><Link href={`/admin/resellers/${s.resellerId}`}>{s.reseller.storeName}</Link></Row>
            <Row label="Owner">{s.reseller.owner.name} · {s.reseller.owner.email}</Row>
            <Row label="Account"><StatusBadge status={s.reseller.status} /> <StatusBadge status={s.reseller.approvalStatus} /></Row>
            <Row label="Last login"><DateTime value={s.reseller.owner.lastLoginAt} /></Row>
          </Card>
          <Card title="Customer">
            <Row label="Email">{isPlaceholderEmail(s.customer.email) ? <span className="muted">no email</span> : s.customer.email}</Row>
            <Row label="Name">{s.customer.name ?? "—"}</Row>
            {s.customer.notes && <Row label="Notes"><span className="whitespace-pre-wrap">{s.customer.notes}</span></Row>}
            <Row label="Customer since"><DateTime value={s.customer.createdAt} dateOnly /></Row>
            {otherLines.length > 0 && (
              <Row label="Other lines">
                {otherLines.map((o) => (
                  <Link key={o.id} href={`/admin/customers/${o.id}`} className="ml-2 font-mono">{o.lineUsername ?? o.id.slice(-6)}</Link>
                ))}
              </Row>
            )}
          </Card>
          <Card title="MaxPlayer">
            <Row label="Status"><StatusBadge status={simulated ? "TEST" : s.maxPlayerStatus} label={simulated ? "simulated (test mode)" : undefined} /></Row>
            <Row label="MaxPlayer account"><span className="font-mono">{s.maxPlayerUserId && !simulated ? `#${s.maxPlayerUserId}` : "—"}</span></Row>
            {s.maxPlayerError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">{s.maxPlayerError}</p>}
            {canRetryMp && (
              <form action={adminRetryMaxPlayerAction} className="mt-3">
                <input type="hidden" name="subscriptionId" value={s.id} />
                <SubmitButton className="btn-secondary btn-sm" confirm={`Create / repair the MaxPlayer account for ${s.lineUsername}?`}>{s.maxPlayerStatus === "ACTIVE" && !simulated ? "Re-sync MaxPlayer" : "Create MaxPlayer account"}</SubmitButton>
              </form>
            )}
            {!s.reseller.maxPlayer?.enabled && <p className="hint mt-2">This reseller has MaxPlayer switched off.</p>}
          </Card>
        </div>
      </div>

      <Card title="Orders of this line" pad={false} className="mt-6">
        {s.orders.length === 0 ? <p className="muted px-4 py-4 text-sm">No orders.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Order</th><th>Type</th><th>Amount</th><th>Status</th><th>Created</th><th>Error</th></tr></thead>
              <tbody>
                {s.orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs">{o.number}</td>
                    <td>{o.kind.toLowerCase()}</td>
                    <td><Money amount={o.amountCents} currency={o.currency} /></td>
                    <td><StatusBadge status={o.status} /></td>
                    <td><DateTime value={o.createdAt} /></td>
                    <td className="max-w-sm whitespace-normal text-xs text-rose-600">{o.errorMessage}{o.status === "ACTIVATION_FAILED" && <> · <Link href="/admin/activations">Retry</Link></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="hint mt-4">Customer: {displayCustomer(s.customer.email, s.lineUsername)} · Passwords are never shown in the admin panel.</p>
    </>
  );
}
