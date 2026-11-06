import Link from "next/link";
import { notFound } from "next/navigation";
import type { PackageSnapshot } from "@/core/activation/engine";
import { getProvider } from "@/core/payments";
import { AutoRefresh, CopyButton, SubmitButton } from "@/components/client";
import { Card, DateTime, Flash, Money, PageHeader, PanelErrorBox, StatusBadge } from "@/components/ui";
import { decrypt } from "@/core/crypto";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderStatusLabel } from "@/lib/orders";
import { refundOrderAction, retryActivationAction } from "../../actions/orders";
import { displayCustomer } from "@/core/importedCustomers";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await requireReseller();
  const o = await db.order.findFirst({ where: { id, resellerId: reseller.id }, include: { customer: true, subscription: true, transactions: true, invoice: true, coupon: true } });
  if (!o) notFound();
  const logs = await db.apiLog.findMany({ where: { orderId: o.id }, orderBy: { createdAt: "asc" } });
  const snap = o.packageSnapshot as unknown as PackageSnapshot;
  const inFlight = ["PAID", "ACTIVATING"].includes(o.status);
  const back = `/dashboard/orders/${o.id}`;
  // Login details of the new line, ready to copy and send to the customer.
  const sub = o.subscription;
  let password: string | null = null;
  try {
    password = sub?.linePasswordEnc ? decrypt(sub.linePasswordEnc) : null;
  } catch {
    password = null;
  }
  const panel = sub ? await db.panelIntegration.findUnique({ where: { id: sub.panelId }, select: { streamUrl: true } }) : null;
  const server = panel?.streamUrl?.replace(/\/+$/, "") || null;
  const mail = o.notifyCustomer
    ? await db.emailLog.findFirst({ where: { resellerId: reseller.id, to: o.customer.email, template: { in: ["subscription_activated", "subscription_renewed"] }, createdAt: { gte: o.createdAt } }, orderBy: { createdAt: "desc" } })
    : null;
  const ready = !!sub?.lineUsername && !!password && (o.status === "COMPLETED" || !!o.activatedAt);
  const m3u = ready && server ? `${server}/get.php?username=${encodeURIComponent(sub!.lineUsername!)}&password=${encodeURIComponent(password!)}&type=m3u_plus&output=ts` : null;
  const allText = ready
    ? [server ? `Server: ${server}` : null, `Username: ${sub!.lineUsername}`, `Password: ${password}`, sub!.expiresAt ? `Valid until: ${sub!.expiresAt.toISOString().slice(0, 10)}` : null, m3u ? `M3U: ${m3u}` : null].filter(Boolean).join("\n")
    : "";
  return (
    <>
      {/* also until the customer's email went out (max. 10 min after activation) */}
      <AutoRefresh active={inFlight || (ready && o.notifyCustomer && (!mail || mail.status === "FAILED") && !!o.activatedAt && Date.now() - o.activatedAt.getTime() < 10 * 60_000)} intervalMs={4000} />
      <PageHeader title={`Order ${o.number}`} description={<StatusBadge status={o.status} label={orderStatusLabel[o.status]} />} />
      <Flash sp={sp} />
      {o.errorMessage && o.status !== "COMPLETED" && <PanelErrorBox message={o.errorMessage} className="mb-6" />}
      {ready && (
        <Card title="Login details" description="Ready to send to the customer." className="mb-6 border-emerald-300 dark:border-emerald-500/40">
          <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {server && <CredRow label="Server" value={server} />}
            <CredRow label="Username" value={sub!.lineUsername!} />
            <CredRow label="Password" value={password!} />
            {sub!.expiresAt && <div className="flex items-center justify-between gap-3 py-2"><dt className="muted">Valid until</dt><dd><DateTime value={sub!.expiresAt} dateOnly /></dd></div>}
            {m3u && <CredRow label="M3U link" value={m3u} small />}
          </dl>
          <p className="muted mt-3 text-xs">
            {!o.notifyCustomer
              ? "No email is sent for this order — send the details yourself (Copy all)."
              : !mail
                ? "Email to the customer: waiting to be sent…"
                : mail.status === "SENT"
                  ? <>Email sent to {o.customer.email} (<DateTime value={mail.createdAt} />{mail.via ? ` · via ${mail.via}` : ""}). Not in the inbox? Ask the customer to check Spam / Promotions.</>
                  : mail.status === "FAILED"
                    ? <span className="text-rose-600">Email could not be sent yet: {mail.error ?? "unknown error"} — it is tried again automatically (Email sending page shows all attempts).</span>
                    : `Email status: ${mail.status.toLowerCase()}.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <CopyButton text={allText} label="Copy all login details" />
            {sub && <Link className="btn-ghost btn-sm" href={`/dashboard/subscriptions/${sub.id}`}>Open line</Link>}
          </div>
        </Card>
      )}
      {inFlight && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm dark:border-slate-800" aria-live="polite">
          <span className="spinner" aria-hidden /> Creating the line on the panel… the login details appear here in a few seconds.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Summary" className="lg:col-span-2">
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="muted">Customer</dt><dd><Link href={`/dashboard/customers/${o.customerId}`}>{displayCustomer(o.customer.email)}</Link></dd></div>
            <div><dt className="muted">Type</dt><dd>{o.kind === "RENEWAL" ? "Renewal" : "New subscription"}</dd></div>
            <div><dt className="muted">Package (as sold)</dt><dd>{snap.name} · {snap.durationDays} days · {snap.maxConnections} conn.</dd></div>
            <div><dt className="muted">Bouquets (panel IDs)</dt><dd>{snap.bouquetIds.join(", ")}</dd></div>
            <div><dt className="muted">Amount</dt><dd><Money amount={o.amountCents} currency={o.currency} />{o.discountCents > 0 && <span className="muted"> (discount <Money amount={o.discountCents} currency={o.currency} />{o.coupon ? ` · ${o.coupon.code}` : ""})</span>}</dd></div>
            <div><dt className="muted">Gateway</dt><dd>{o.provider.toLowerCase()} {o.providerPaymentId && <code className="text-xs">{o.providerPaymentId}</code>}</dd></div>
            <div><dt className="muted">Created</dt><dd><DateTime value={o.createdAt} /></dd></div>
            <div><dt className="muted">Paid</dt><dd><DateTime value={o.paidAt} /></dd></div>
            <div><dt className="muted">Activated</dt><dd><DateTime value={o.activatedAt} /></dd></div>
            <div><dt className="muted">Activation attempts</dt><dd>{o.attempts}</dd></div>
            <div><dt className="muted">Subscription</dt><dd>{o.subscriptionId ? <Link href={`/dashboard/subscriptions/${o.subscriptionId}`}>Open</Link> : "—"}</dd></div>
            <div><dt className="muted">Invoice</dt><dd>{o.invoice?.number ?? "—"}</dd></div>
          </dl>
        </Card>
        <Card title="Actions">
          <div className="space-y-3">
            {["ACTIVATION_FAILED", "ON_HOLD", "PAID", "ACTIVATING"].includes(o.status) && (
              <form action={retryActivationAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="back" value={back} />
                <SubmitButton className="btn-primary w-full">Retry activation</SubmitButton>
              </form>
            )}
            {o.providerPaymentId && o.amountCents > 0 && o.status !== "REFUNDED" && getProvider(o.provider).supportsRefunds && (
              <form action={refundOrderAction}>
                <input type="hidden" name="orderId" value={o.id} />
                <input type="hidden" name="back" value={back} />
                <SubmitButton className="btn-danger w-full" confirm="Refund the full amount to the customer?">Refund payment</SubmitButton>
              </form>
            )}
            {inFlight && <p className="muted text-center">Activation in progress — this page refreshes automatically.</p>}
          </div>
        </Card>
      </div>
      <Card title="Activation log" pad={false} className="mt-6">
        {logs.length === 0 ? <p className="muted p-5">No API calls recorded for this order yet.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Service</th><th>Action</th><th>Result</th><th>Details</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td><DateTime value={l.createdAt} /></td>
                    <td>{l.service}</td>
                    <td className="font-mono text-xs">{l.action}</td>
                    <td>{l.success ? <span className="badge-green">ok</span> : <span className="badge-red">error</span>} {l.durationMs != null && <span className="muted text-xs">{l.durationMs} ms</span>}</td>
                    <td className="max-w-md whitespace-normal text-xs">{l.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function CredRow({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="muted shrink-0">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className={`select-all break-all ${small ? "text-xs" : "font-semibold"}`}>{value}</code>
        <CopyButton text={value} compact />
      </dd>
    </div>
  );
}
