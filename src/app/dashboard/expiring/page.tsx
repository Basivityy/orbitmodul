import Link from "next/link";
import { reminderText, viberLink, whatsappLink } from "@/core/engage";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { CopyButton, SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { EXPIRING_TABS, expiringWhere, parseExpiringTab } from "@/lib/expiring";
import { storeBaseUrl } from "@/lib/urls";
import { sendReminderAction, sendRemindersBulkAction, setCustomerPhoneAction } from "../actions/expiring";

export const metadata = { title: "Expiring lines" };
export const dynamic = "force-dynamic";

export default async function ExpiringPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const tab = parseExpiringTab(sp.tab);
  const now = new Date();
  const [rows, counts] = await Promise.all([
    db.subscription.findMany({ where: expiringWhere(reseller.id, tab, now), include: { customer: true, package: true }, orderBy: { expiresAt: tab === "expired" ? "desc" : "asc" }, take: 500 }),
    Promise.all(EXPIRING_TABS.map((t) => db.subscription.count({ where: expiringWhere(reseller.id, t.key, now) }))),
  ]);
  const renewUrl = `${storeBaseUrl(reseller)}/renew`;
  const here = `/dashboard/expiring?tab=${tab}`;
  const withEmail = rows.filter((r) => !isPlaceholderEmail(r.customer.email)).length;
  return (
    <>
      <PageHeader
        title="Expiring lines"
        description="Remind customers before their line runs out — by email, WhatsApp or Viber. Customers renew on your store with their username."
        actions={tab !== "expired" && withEmail > 0 ? (
          <form action={sendRemindersBulkAction}>
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="back" value={here} />
            <SubmitButton className="btn-primary" confirm={`Email a reminder to ${withEmail} customer(s)? Lines reminded in the last 24 hours are skipped.`}>✉ Email all ({withEmail})</SubmitButton>
          </form>
        ) : undefined}
      />
      <Flash sp={sp} />
      <div className="mb-4 flex flex-wrap gap-2">
        {EXPIRING_TABS.map((t, i) => (
          <Link key={t.key} href={`/dashboard/expiring?tab=${t.key}`} className={t.key === tab ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{t.label} <span className="ml-1 opacity-70">{counts[i]}</span></Link>
        ))}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty title="Nothing here">{tab === "expired" ? "No line expired in the last 30 days without being renewed." : "No line expires in this period."}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Line</th><th>Customer</th><th>Package</th><th>{tab === "expired" ? "Expired" : "Expires"}</th><th>Remind</th></tr></thead>
              <tbody>
                {rows.map((s) => {
                  const text = reminderText({ storeName: reseller.storeName, username: s.lineUsername, packageName: s.package.name, expiresAt: s.expiresAt!, renewUrl }, now);
                  const days = Math.ceil((s.expiresAt!.getTime() - now.getTime()) / 86_400_000);
                  const hasEmail = !isPlaceholderEmail(s.customer.email);
                  return (
                    <tr key={s.id}>
                      <td><Link className="font-mono" href={`/dashboard/subscriptions/${s.id}`}>{s.lineUsername ?? "—"}</Link></td>
                      <td className="min-w-52">
                        <div className="text-sm">{hasEmail ? s.customer.email : <span className="muted">no email</span>}</div>
                        <form action={setCustomerPhoneAction} className="mt-1 flex gap-1">
                          <input type="hidden" name="customerId" value={s.customerId} />
                          <input type="hidden" name="back" value={here} />
                          <input className="input w-36 py-1 text-xs" name="phone" defaultValue={s.customer.phone ? `+${s.customer.phone}` : ""} placeholder="+387 6x xxx xxx" aria-label="Phone" inputMode="tel" />
                          <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                        </form>
                      </td>
                      <td className="text-sm">{s.package.name}</td>
                      <td className="whitespace-nowrap">
                        <DateTime value={s.expiresAt} dateOnly />
                        <div className={days <= 2 ? "text-xs text-rose-600" : "muted text-xs"}>{days > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${-days} day${days === -1 ? "" : "s"} ago`}</div>
                        {s.reminderSentAt && <div className="muted text-xs">reminded <DateTime value={s.reminderSentAt} dateOnly /></div>}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <a className="btn-secondary btn-sm" href={whatsappLink(s.customer.phone, text)} target="_blank" rel="noreferrer">WhatsApp</a>
                          <a className="btn-secondary btn-sm" href={viberLink(text)}>Viber</a>
                          <CopyButton text={text} label="Copy text" />
                          {hasEmail && days > 0 && (
                            <form action={sendReminderAction}>
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="back" value={here} />
                              <SubmitButton className="btn-secondary btn-sm">Email</SubmitButton>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="hint mt-4">Customers with an email also get an automatic reminder 3 days before expiry. WhatsApp opens with the text ready — with a saved phone number it goes straight to that customer. Lines with automatic card renewal are not listed.</p>
    </>
  );
}
