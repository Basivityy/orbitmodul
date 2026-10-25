import Link from "next/link";
import { cookies } from "next/headers";
import { decrypt } from "@/core/crypto";
import { NEW_KEY_COOKIE } from "@/core/partnerApi";
import { CopyButton, Secret, SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Flash, PageHeader, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createApiKeyAction, revokeApiKeyAction, rotateWebhookSecretAction, saveWebhookAction, testWebhookAction } from "../actions/website";

export const metadata = { title: "Website API & widget" };
export const dynamic = "force-dynamic";

export default async function WebsiteApiPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  if (!reseller.partnerApiEnabled) {
    return (
      <>
        <PageHeader title="Website API & widget" />
        <Card><Empty title="Not available for your account">Ask the platform administrator to enable the Website API.</Empty></Card>
      </>
    );
  }
  const [keys, hook] = await Promise.all([
    db.resellerApiKey.findMany({ where: { resellerId: reseller.id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    db.resellerWebhook.findUnique({ where: { resellerId: reseller.id } }),
  ]);
  let newKey: string | null = null;
  try {
    const c = (await cookies()).get(NEW_KEY_COOKIE)?.value;
    newKey = c ? decrypt(c) : null;
  } catch {
    newKey = null;
  }
  const origin = env.appUrl.replace(/\/+$/, "");
  const apiBase = `${origin}/api/partner/v1`;
  const snippet = `<div data-orbitmodul-store="${reseller.slug}" data-theme="dark"></div>\n<script src="${origin}/widget.js" async></script>`;
  return (
    <>
      <PageHeader
        title="Website API & widget"
        description="Sell on your own website: put the store widget on any page, or connect your site's backend to the API so lines are created and extended automatically."
        actions={<Link className="btn-secondary" href="/dashboard/website-api/docs">API documentation</Link>}
      />
      <Flash sp={sp} />
      {newKey && (
        <div className="mb-6 rounded-lg border-2 border-brand-500 bg-brand-50 p-4 dark:bg-brand-500/10">
          <b>Your new API key — copy it now, it is not shown again:</b>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="select-all break-all rounded bg-white px-2 py-1 text-sm dark:bg-black">{newKey}</code>
            <CopyButton text={newKey} />
          </div>
          <p className="hint mt-2">Keep it on your server only (never in the HTML or JavaScript of your pages) — anyone with this key can create lines on your account.</p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. Store widget (no programming)" description="Paste this where the packages should appear — works on any site, also Wix (Embed → Custom code / HTML iframe).">
          <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-xs dark:bg-slate-900">{snippet}</pre>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <CopyButton text={snippet} label="Copy code" />
            <a className="btn-secondary btn-sm" href={`${origin}/embed/${reseller.slug}`} target="_blank" rel="noreferrer">Preview ↗</a>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm muted">
            <li>Shows your packages (prices, duration, bouquets) with <b>Buy</b>, plus <b>Extend my line</b> and <b>I have a code</b>.</li>
            <li>Payment and line creation run on your secure store pages — with your payment gateways.</li>
            <li><span className="font-mono">data-theme=&quot;light&quot;</span> for light websites · <span className="font-mono">data-target=&quot;blank&quot;</span> opens checkout in a new tab.</li>
          </ul>
        </Card>

        <Card title="2. API keys (for your website's backend)" description={<>Base URL: <code className="select-all">{apiBase}</code></>}>
          <form action={createApiKeyAction} className="mb-4 flex flex-wrap gap-2">
            <input className="input max-w-xs flex-1" name="name" placeholder="Name, e.g. WooCommerce" maxLength={60} />
            <SubmitButton>Create key</SubmitButton>
          </form>
          {keys.length === 0 ? (
            <p className="muted text-sm">No keys yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><b>{k.name}</b> · <code>{k.prefix}…</code> · last used {k.lastUsedAt ? <DateTime value={k.lastUsedAt} /> : "never"}</span>
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm={`Delete key “${k.name}”? Your website stops working with it at once.`}>Delete</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="hint mt-3">Every call with a valid key is treated as <b>paid</b> (like “Add customer”) and uses credits on your panel — keep keys secret.</p>
        </Card>

        <Card title="3. Webhook (optional)" description="We call your website when a line is created or extended, an activation fails, or a line expires in 3 days." className="lg:col-span-2">
          <form action={saveWebhookAction} className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input className="input max-w-xl flex-1" name="url" type="url" defaultValue={hook?.url ?? ""} placeholder="https://yoursite.com/orbitmodul-webhook" />
              <SubmitButton>Save</SubmitButton>
            </div>
            <Toggle name="enabled" label="Send events" defaultChecked={hook?.enabled ?? true} />
          </form>
          {hook && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
              <div>Signing secret (to verify <span className="font-mono">X-OrbitModul-Signature</span>): <Secret value={decrypt(hook.secretEnc)} /></div>
              <div className="muted">Last delivery: {hook.lastSentAt ? <><DateTime value={hook.lastSentAt} /> — {hook.lastStatus}</> : "none yet"}</div>
              <div className="flex flex-wrap gap-2">
                <form action={testWebhookAction}><SubmitButton className="btn-secondary btn-sm">Send test event</SubmitButton></form>
                <form action={rotateWebhookSecretAction}><SubmitButton className="btn-ghost btn-sm" confirm="Create a new signing secret? The old one stops being valid.">New secret</SubmitButton></form>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
