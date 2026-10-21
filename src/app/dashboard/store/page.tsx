import { SUPPORTED_CURRENCIES } from "@/core/money";
import { CopyButton, SubmitButton } from "@/components/client";
import { Card, Field, Flash, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { env } from "@/lib/env";
import { loadResellerSaas, planLimits } from "@/lib/saas";
import { storeBaseUrl } from "@/lib/urls";
import { saveStoreAction, setDomainAction, verifyDomainAction } from "../actions/store";

export const metadata = { title: "Store page" };

export default async function StorePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const limits = planLimits(await loadResellerSaas(reseller.id));
  const platformHost = env.appHost.replace(/:\d+$/, "");
  return (
    <>
      <PageHeader title="Store page" description="Your branded storefront where customers choose a package and pay." actions={<a className="btn-secondary" href={storeBaseUrl(reseller)} target="_blank" rel="noreferrer">Open store ↗</a>} />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Branding & content" className="lg:col-span-2">
          <form action={saveStoreAction} className="space-y-4">
            <div className="grid-form">
              <Field label="Store name" name="storeName"><input className="input" id="storeName" name="storeName" defaultValue={reseller.storeName} required /></Field>
              <Field label="Store address" name="slug" hint={`${env.appUrl}/store/${reseller.slug}`}><input className="input" id="slug" name="slug" defaultValue={reseller.slug} pattern="[a-z0-9-]{3,40}" required /></Field>
              <Field label="Logo URL (https)" name="logoUrl"><input className="input" id="logoUrl" name="logoUrl" type="url" defaultValue={reseller.logoUrl ?? ""} placeholder="https://…/logo.png" /></Field>
              <Field label="Default currency" name="defaultCurrency">
                <select className="input" id="defaultCurrency" name="defaultCurrency" defaultValue={reseller.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label="Primary color" name="primaryColor"><input className="input h-10 p-1" id="primaryColor" name="primaryColor" type="color" defaultValue={reseller.primaryColor} /></Field>
              <Field label="Accent color" name="accentColor"><input className="input h-10 p-1" id="accentColor" name="accentColor" type="color" defaultValue={reseller.accentColor} /></Field>
            </div>
            <Field label="Description" name="description"><textarea className="input" id="description" name="description" rows={3} defaultValue={reseller.description ?? ""} /></Field>
            <div className="grid-form">
              <Field label="Contact email" name="contactEmail"><input className="input" id="contactEmail" name="contactEmail" type="email" defaultValue={reseller.contactEmail ?? ""} /></Field>
              <Field label="Phone" name="contactPhone"><input className="input" id="contactPhone" name="contactPhone" defaultValue={reseller.contactPhone ?? ""} /></Field>
              <Field label="Telegram" name="contactTelegram"><input className="input" id="contactTelegram" name="contactTelegram" defaultValue={reseller.contactTelegram ?? ""} placeholder="@yourhandle" /></Field>
              <Field label="WhatsApp" name="contactWhatsapp"><input className="input" id="contactWhatsapp" name="contactWhatsapp" defaultValue={reseller.contactWhatsapp ?? ""} placeholder="+387…" /></Field>
            </div>
            <Field label="Terms of service" name="termsText"><textarea className="input" id="termsText" name="termsText" rows={5} defaultValue={reseller.termsText ?? ""} /></Field>
            <Field label="Refund policy" name="refundPolicy"><textarea className="input" id="refundPolicy" name="refundPolicy" rows={4} defaultValue={reseller.refundPolicy ?? ""} /></Field>
            <Field label="Line username prefix (optional)" name="linePrefix" hint="Letters/numbers, max 8. New lines get usernames like prefix + random characters."><input className="input max-w-xs" id="linePrefix" name="linePrefix" defaultValue={reseller.linePrefix} maxLength={8} /></Field>
            <SubmitButton>Save store</SubmitButton>
          </form>
        </Card>
        <div className="space-y-6">
          <Card title="Store links">
            <p className="muted mb-2">Share this address with your customers:</p>
            <div className="flex items-center gap-2"><code className="flex-1 break-all text-xs">{storeBaseUrl(reseller)}</code><CopyButton text={storeBaseUrl(reseller)} /></div>
            <p className="muted mb-2 mt-4">Customer portal:</p>
            <code className="block break-all text-xs">{storeBaseUrl(reseller)}/portal</code>
          </Card>
          <Card title="Custom domain">
            <div id="domain" />
            {!limits.allowCustomDomain ? (
              <p className="muted">Custom domains are available on higher plans.</p>
            ) : reseller.customDomain ? (
              <div className="space-y-3 text-sm">
                <p><b>{reseller.customDomain}</b> {reseller.customDomainVerified ? <span className="badge-green">verified</span> : <span className="badge-amber">pending</span>}</p>
                {!reseller.customDomainVerified && (
                  <>
                    <p className="muted">Add these DNS records at your domain provider:</p>
                    <div className="rounded-lg bg-slate-100 p-3 font-mono text-xs dark:bg-slate-800">
                      <div>TXT  _xuibilling.{reseller.customDomain}</div>
                      <div className="break-all">     {reseller.domainVerifyToken}</div>
                      <div className="mt-2">CNAME {reseller.customDomain}</div>
                      <div>      {platformHost}</div>
                    </div>
                    <p className="hint">Using Cloudflare? Enable the orange-cloud proxy on the CNAME so HTTPS works immediately.</p>
                    <form action={verifyDomainAction}><SubmitButton className="w-full">Verify domain</SubmitButton></form>
                  </>
                )}
                <form action={setDomainAction}><input type="hidden" name="op" value="remove" /><SubmitButton className="btn-ghost w-full text-rose-600" confirm="Remove the custom domain?">Remove domain</SubmitButton></form>
              </div>
            ) : (
              <form action={setDomainAction} className="space-y-3">
                <input className="input" name="domain" placeholder="shop.yourdomain.com" required />
                <SubmitButton className="w-full">Connect domain</SubmitButton>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
