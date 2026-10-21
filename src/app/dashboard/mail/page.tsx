import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Field, Flash, PageHeader, Pagination, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformSmtpSource } from "@/lib/mailer";
import { removeMailSettingsAction, saveMailSettingsAction, testMailSettingsAction } from "../actions/mail";

export const metadata = { title: "Email sending" };

const PAGE = 50;
const TEMPLATE_LABELS: Record<string, string> = {
  subscription_activated: "Access details",
  subscription_renewed: "Extended",
  subscription_expiring: "Expiry reminder",
  payment_failed: "Payment failed",
  customer_login: "Account login link",
  purchase_received: "Payment received",
  test: "Test email",
};

export default async function MailPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { user, reseller } = await requireReseller();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.EmailLogWhereInput = { resellerId: reseller.id };
  if (sp.q) where.to = { contains: sp.q.toLowerCase() };
  if (sp.status) where.status = sp.status as Prisma.EmailLogWhereInput["status"];
  const [m, logs, platformMail] = await Promise.all([
    db.resellerMail.findUnique({ where: { resellerId: reseller.id } }),
    db.emailLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 }),
    platformSmtpSource(),
  ]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && ["q", "status"].includes(k)) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Email sending" description="Send your customers' emails (access details, extensions, reminders) from your own email address, and see everything that was sent." actions={<Link className="btn-secondary" href="/dashboard/emails">Edit email texts</Link>} />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your mailbox (SMTP)" className="lg:col-span-2" description={m?.enabled ? <span className="badge-green">active — customers get emails from {m.fromEmail}</span> : <span className="badge-gray">{platformMail.source ? "not set — emails go out from the platform address" : "not set"}</span>}>
          <form action={saveMailSettingsAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="SMTP server" name="host"><input className="input" id="host" name="host" defaultValue={m?.host ?? ""} placeholder="smtp.gmail.com" required /></Field>
              <Field label="Port" name="port"><input className="input" id="port" name="port" type="number" defaultValue={m?.port ?? 587} required /></Field>
              <Field label="Encryption" name="secure">
                <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="secure" defaultChecked={m?.secure ?? false} /> SSL (port 465)</label>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username / login" name="username"><input className="input" id="username" name="username" defaultValue={m?.username ?? ""} autoComplete="off" required /></Field>
              <Field label="Password / app password / SMTP key" name="password" hint={m ? "Saved — leave empty to keep it." : undefined}><input className="input" id="password" name="password" type="password" autoComplete="new-password" placeholder={m ? "••••••••" : ""} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sender email (From)" name="fromEmail"><input className="input" id="fromEmail" name="fromEmail" type="email" defaultValue={m?.fromEmail ?? ""} placeholder="support@yourdomain.com" required /></Field>
              <Field label="Sender name" name="fromName" hint="Same as Email texts → Sender name. Empty = store name."><input className="input" id="fromName" name="fromName" defaultValue={reseller.emailFromName ?? m?.fromName ?? ""} placeholder={reseller.storeName} maxLength={80} /></Field>
            </div>
            <Toggle name="enabled" label="Send my customers' emails through this mailbox" defaultChecked={m?.enabled ?? true} hint="If your mailbox fails, the email is sent through the platform instead (so the customer still gets it) and the error is shown below." />
            <div className="flex flex-wrap gap-2">
              <SubmitButton>Save</SubmitButton>
            </div>
          </form>
          {m && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <form action={testMailSettingsAction} className="flex flex-wrap items-center gap-2">
                <input className="input w-60" name="to" type="email" defaultValue={user.email} placeholder="Send test to…" aria-label="Test email address" required />
                <SubmitButton className="btn-secondary">Send test email</SubmitButton>
              </form>
              <form action={removeMailSettingsAction}><SubmitButton className="btn-ghost text-rose-600" confirm="Remove your email settings? Emails go out through the platform again.">Remove</SubmitButton></form>
              <span className="muted text-xs">{m.lastError ? <span className="text-rose-600">Last error: {m.lastError}</span> : m.lastTestAt ? <>Last successful test: <DateTime value={m.lastTestAt} /></> : null}</span>
            </div>
          )}
        </Card>
        <Card title="Settings for common providers">
          <dl className="space-y-3 text-sm">
            <div><dt className="font-semibold">Gmail</dt><dd className="muted">smtp.gmail.com · 587 · login = your Gmail · password = <b>App password</b> (Google account → Security → App passwords)</dd></div>
            <div><dt className="font-semibold">Brevo</dt><dd className="muted">smtp-relay.brevo.com · 587 · login and SMTP key from Brevo → SMTP &amp; API</dd></div>
            <div><dt className="font-semibold">Zoho Mail</dt><dd className="muted">smtp.zoho.eu · 465 + SSL · your Zoho email and password</dd></div>
            <div><dt className="font-semibold">Microsoft 365 (business Outlook)</dt><dd className="muted">smtp.office365.com · 587 · your email and password. “Authenticated SMTP” must be on for the mailbox (Microsoft 365 admin → Users → Mail → Manage email apps).</dd></div>
            <div><dt className="font-semibold">Outlook.com / Hotmail</dt><dd className="muted">smtp-mail.outlook.com · 587. Microsoft is phasing out password sign-in for apps — if it fails, use Brevo or Gmail.</dd></div>
          </dl>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Sent emails" pad={false}>
          <form className="flex flex-wrap gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
            <input className="input max-w-xs" name="q" defaultValue={sp.q ?? ""} placeholder="Customer email" />
            <select className="input max-w-[10rem]" name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
              <option value="LOGGED">Not sent (no SMTP)</option>
            </select>
            <button className="btn-secondary">Filter</button>
          </form>
          {logs.length === 0 ? <Empty title="No emails yet" /> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.slice(0, PAGE).map((l) => (
                <li key={l.id} className="px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="tabular-nums muted w-36"><DateTime value={l.createdAt} /></span>
                      <span className="font-medium">{l.to}</span>
                      <span className="badge-gray">{TEMPLATE_LABELS[l.template] ?? l.template}</span>
                      {l.status === "SENT" ? <span className="badge-green">sent</span> : l.status === "FAILED" ? <span className="badge-red">failed</span> : <span className="badge-amber">not sent</span>}
                      <span className="muted text-xs">{l.via === "reseller" ? `from ${l.fromEmail}` : l.via?.startsWith("platform") ? `via platform${l.via.includes("fallback") ? " (your mailbox failed)" : ""}` : l.via === "log" ? "no SMTP configured" : ""}</span>
                    </summary>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                      {l.subject && <div className="mb-2 font-semibold">{l.subject}</div>}
                      {l.body ? <pre className="whitespace-pre-wrap font-sans text-xs">{l.body}</pre> : <p className="muted text-xs">Content not stored for older emails.</p>}
                      {l.error && <p className="mt-2 text-xs text-rose-600">{l.error}</p>}
                      <p className="hint mt-2">Passwords are hidden here; the customer received them.</p>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} hasMore={logs.length > PAGE} baseHref={`/dashboard/mail?${qs}`} />
        </Card>
      </div>
    </>
  );
}
