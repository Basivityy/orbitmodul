import { SubmitButton } from "@/components/client";
import { Card, Field, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { platformBillingConfigured } from "@/lib/platformBilling";
import { getSetting, SETTING_BILLING_ENABLED, SETTING_GLOBAL_NOTICE, SETTING_REGISTRATION_OPEN, SETTING_RESELLER_PLANS, SETTING_STORE_TEST_PAYMENTS } from "@/lib/settings";
import { getPlatformSmtpSetting, platformSmtpSource } from "@/lib/mailer";
import { savePlatformSettingsAction, savePlatformSmtpAction, savePublicUrlAction, sendTestEmailAction } from "../actions";
import { refreshPublicUrl } from "@/lib/publicUrl";

export const metadata = { title: "Global settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireSuperAdmin();
  const sp = await searchParams;
  const publicUrl = await refreshPublicUrl(0);
  const [billing, registration, notice, testPayments, resellerPlans, smtp, smtpSource] = await Promise.all([
    getSetting<boolean>(SETTING_BILLING_ENABLED, true),
    getSetting<boolean>(SETTING_REGISTRATION_OPEN, true),
    getSetting<string>(SETTING_GLOBAL_NOTICE, ""),
    getSetting<boolean>(SETTING_STORE_TEST_PAYMENTS, false),
    getSetting<boolean>(SETTING_RESELLER_PLANS, false),
    getPlatformSmtpSetting(),
    platformSmtpSource(),
  ]);
  return (
    <>
      <PageHeader title="Global settings" />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Service switches">
          <form action={savePlatformSettingsAction} className="space-y-5">
            <Toggle name="billingEnabled" label="Billing service enabled" defaultChecked={billing} hint="Turn off to pause the whole platform: all stores stop accepting orders and paid orders wait ON HOLD (released automatically when turned back on). Customer lines are never modified." />
            <Toggle name="registrationOpen" label="New reseller registration open" defaultChecked={registration} hint="New resellers always wait for your approval (Resellers → Waiting for approval)." />
            <Toggle name="resellerPlans" label="Charge resellers for the platform (SaaS plans)" defaultChecked={resellerPlans} hint="Off (recommended now): approved resellers use everything for free — no plans, trial or limits, and the plan pages are hidden. On: resellers need a paid plan (SaaS plans page, Stripe)." />
            <Toggle name="storeTestPayments" label="Test mode for payments (all stores)" defaultChecked={testPayments} hint="Every store shows “Test payment” at checkout: the customer clicks Pay on a simulated payment page, no Stripe/PayPal needed and no money is charged. Everything after payment runs for real: line on the panel (unless the panel is in test mode), MaxPlayer, access details, email. Turn OFF before real customers use the store." />
            <div>
              <label className="label" htmlFor="notice">Notice for administrators (internal)</label>
              <textarea className="input" id="notice" name="notice" rows={2} defaultValue={notice} />
            </div>
            <SubmitButton>Save</SubmitButton>
          </form>
        </Card>
        <Card title="Platform address (domain)" className="lg:col-span-2">
          <form action={savePublicUrlAction} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="input flex-1 font-mono" name="publicUrl" defaultValue={publicUrl ?? ""} placeholder="https://billing.yourdomain.com" />
              <SubmitButton>Save address</SubmitButton>
            </div>
            <p className="hint">Used in every link the platform creates — stores, activation links, emails, payment webhooks, the App API — instead of <code>{env.installUrl}</code>. Point the domain to this server first (DNS A record → server IP; with Cloudflare the orange cloud gives you HTTPS). Leave empty to use the server address. The old address keeps working.</p>
            <p className="text-sm">Links now use: <b className="font-mono">{env.appUrl}</b></p>
          </form>
        </Card>
        <Card title="Email sending (SMTP)" className="lg:col-span-2" description={smtpSource.source ? <span className="badge-green">active — {smtpSource.host}{smtpSource.source === "env" ? " (from .env)" : ""}</span> : <span className="badge-amber">not set up — emails are not sent</span>}>
          <div id="smtp" className="grid gap-6 lg:grid-cols-3">
            <form action={savePlatformSmtpAction} className="space-y-4 lg:col-span-2">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="SMTP server" name="smtp-host"><input className="input" id="smtp-host" name="host" defaultValue={smtp?.host ?? ""} placeholder="smtp-relay.brevo.com" required /></Field>
                <Field label="Port" name="smtp-port"><input className="input" id="smtp-port" name="port" type="number" defaultValue={smtp?.port ?? 587} required /></Field>
                <Field label="Encryption" name="smtp-secure">
                  <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="secure" defaultChecked={smtp?.secure ?? false} /> SSL (port 465)</label>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username / login" name="smtp-user"><input className="input" id="smtp-user" name="username" defaultValue={smtp?.user ?? ""} autoComplete="off" required /></Field>
                <Field label="Password / app password / SMTP key" name="smtp-pass" hint={smtp ? "Saved — leave empty to keep it." : undefined}><input className="input" id="smtp-pass" name="password" type="password" autoComplete="new-password" placeholder={smtp ? "••••••••" : ""} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sender email (From)" name="smtp-from"><input className="input" id="smtp-from" name="fromEmail" type="email" defaultValue={smtp?.fromEmail ?? ""} placeholder="no-reply@yourdomain.com" required /></Field>
                <Field label="Sender name" name="smtp-name"><input className="input" id="smtp-name" name="fromName" defaultValue={smtp?.fromName ?? env.platformName} maxLength={80} /></Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <SubmitButton>Save email settings</SubmitButton>
                {smtp && <SubmitButton name="op" value="remove" className="btn-ghost text-rose-600" confirm="Remove the email settings?">Remove</SubmitButton>}
              </div>
              <p className="hint">Used for platform emails (registrations, approvals, password resets) and for every store that has not set up its own mailbox. Stores send in their own name; customers&apos; replies go to the store&apos;s contact email. The password is stored encrypted.</p>
            </form>
            <div className="space-y-4">
              <form action={sendTestEmailAction} className="space-y-2">
                <label className="label" htmlFor="smtp-test">Send a test email</label>
                <input className="input" id="smtp-test" name="to" type="email" defaultValue={me.email} required />
                <SubmitButton className="btn-secondary w-full">Send test</SubmitButton>
              </form>
              <dl className="space-y-2 text-xs">
                <div><dt className="font-semibold">Brevo (free, recommended)</dt><dd className="muted">smtp-relay.brevo.com · 587 · login and SMTP key from Brevo → SMTP &amp; API</dd></div>
                <div><dt className="font-semibold">Microsoft 365 (business Outlook)</dt><dd className="muted">smtp.office365.com · 587 · full email + password. Turn on “Authenticated SMTP” for the mailbox.</dd></div>
                <div><dt className="font-semibold">Gmail</dt><dd className="muted">smtp.gmail.com · 587 · App password</dd></div>
              </dl>
            </div>
          </div>
        </Card>
        <Card title="Environment (read-only)">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="muted">Server address (.env)</dt><dd>{env.installUrl}</dd></div>
            <div className="flex justify-between"><dt className="muted">Live panel operations</dt><dd>{env.liveOperationsAllowed ? <span className="badge-green">enabled</span> : <span className="badge-amber">disabled — test mode forced</span>}</dd></div>
            <div className="flex justify-between"><dt className="muted">SMTP</dt><dd>{smtpSource.source ? <span className="badge-green">{smtpSource.host}</span> : <span className="badge-amber">not configured — emails are only logged</span>}</dd></div>
            {resellerPlans && (
              <>
                <div className="flex justify-between"><dt className="muted">Platform Stripe (SaaS billing)</dt><dd>{platformBillingConfigured() ? <span className="badge-green">configured</span> : <span className="badge-gray">not configured</span>}</dd></div>
                <div className="flex justify-between"><dt className="muted">Trial length</dt><dd>{env.trialDays} days</dd></div>
                <div className="flex justify-between"><dt className="muted">SaaS webhook URL</dt><dd className="break-all text-xs">{env.appUrl}/api/webhooks/platform/stripe</dd></div>
              </>
            )}
          </dl>
          <p className="hint mt-4">To approve real line creation, set ALLOW_LIVE_PANEL_OPERATIONS=true in .env and restart the app and worker.</p>
        </Card>
      </div>
    </>
  );
}
