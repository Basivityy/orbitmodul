import Link from "next/link";
import { decrypt } from "@/core/crypto";
import { maskApiKey, MaxPlayerClient } from "@/core/adapters/maxplayer";
import { SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Field, Flash, PageHeader, StatusBadge, Toggle } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadResellerSaas, planLimits } from "@/lib/saas";
import { createMissingMaxPlayerAction, enableMaxPlayerAllPackagesAction, retryMaxPlayerAction, saveMaxPlayerAction, testMaxPlayerAction } from "../actions/integrations";
import { displayCustomer, IMPORT_PACKAGE_NAME } from "@/core/importedCustomers";

export const metadata = { title: "MaxPlayer" };

const domainCache = new Map<string, { key: string; at: number; domains: Array<{ id: string; label: string }> }>();

export default async function MaxPlayerPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const [mp, limits, subs, packages, calls, missing, waitingCount, limitHit] = await Promise.all([
    db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id } }),
    loadResellerSaas(reseller.id).then(planLimits),
    db.subscription.findMany({ where: { resellerId: reseller.id, maxPlayerStatus: { not: "NONE" } }, include: { customer: true }, orderBy: { updatedAt: "desc" }, take: 50 }),
    // All packages, also those not on sale: activation codes and "Add customer" use them too.
    db.package.findMany({ where: { resellerId: reseller.id, name: { not: IMPORT_PACKAGE_NAME } }, select: { id: true, name: true, maxPlayerEnabled: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.apiLog.findMany({ where: { resellerId: reseller.id, service: "MAXPLAYER" }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.subscription.count({
      where: {
        resellerId: reseller.id,
        isTest: false,
        lineUsername: { not: null },
        OR: [
          { maxPlayerStatus: { in: ["PENDING", "FAILED"] } },
          { maxPlayerUserId: { startsWith: "TEST-" } },
          { maxPlayerStatus: "NONE", status: "ACTIVE", linePasswordEnc: { not: null }, package: { maxPlayerEnabled: true, name: { not: IMPORT_PACKAGE_NAME } } },
        ],
      },
    }),
    db.subscription.count({ where: { resellerId: reseller.id, isTest: false, lineUsername: { not: null }, maxPlayerStatus: "PENDING" } }),
    db.subscription.findFirst({ where: { resellerId: reseller.id, maxPlayerStatus: "PENDING", maxPlayerError: { startsWith: "MaxPlayer request limit" } }, select: { maxPlayerError: true }, orderBy: { updatedAt: "desc" } }),
  ]);
  const storedKey = mp ? maskApiKey(decrypt(mp.apiKeyEnc)) : "";
  let domains: Array<{ id: string; label: string }> = [];
  let domainError: string | null = null;
  if (mp && mp.status === "CONNECTED") {
    // Cached for 10 minutes: opening this page should not spend MaxPlayer API requests every time.
    const key = `${mp.id}:${mp.updatedAt.getTime()}`;
    const hit = domainCache.get(reseller.id);
    if (hit && hit.key === key && hit.at > Date.now() - 10 * 60_000) domains = hit.domains;
    else {
      try {
        domains = await new MaxPlayerClient(decrypt(mp.apiKeyEnc), process.env.MAXPLAYER_API_BASE || undefined).domains();
        domainCache.set(reseller.id, { key, at: Date.now(), domains });
      } catch (e) {
        domainError = (e as Error).message;
      }
    }
  }
  const limitNote = limitHit?.maxPlayerError ?? null;
  const notQueued = Math.max(0, missing - waitingCount);
  const simulated = (id: string | null) => !!id && id.startsWith("TEST-");
  const counts = { active: subs.filter((s) => s.maxPlayerStatus === "ACTIVE" && !simulated(s.maxPlayerUserId)).length, failed: subs.filter((s) => s.maxPlayerStatus === "FAILED").length };
  const withMp = packages.filter((p) => p.maxPlayerEnabled);
  const withoutMp = packages.filter((p) => !p.maxPlayerEnabled);
  const live = !!mp && mp.enabled && !mp.testMode && env.liveOperationsAllowed && !!mp.domainId && mp.status === "CONNECTED";
  const checks: Array<{ ok: boolean; label: string; fix?: React.ReactNode }> = [
    { ok: !!mp && mp.status === "CONNECTED", label: "API token connected", fix: "Paste the token below, Save, then click Test connection." },
    { ok: !!mp?.domainId, label: "Domain selected", fix: "Choose the domain below and Save." },
    { ok: !!mp?.enabled, label: "MaxPlayer enabled", fix: "Tick “Enabled” below and Save." },
    { ok: !!mp && !mp.testMode, label: "Test mode OFF (real accounts)", fix: "Untick “Test mode” below and Save. In test mode nothing is created on MaxPlayer." },
    { ok: env.liveOperationsAllowed, label: "Live operations allowed on the server", fix: "The platform administrator must set ALLOW_LIVE_PANEL_OPERATIONS=true." },
    {
      ok: packages.length > 0 && withoutMp.length === 0,
      label: !packages.length ? "You have no packages yet" : !withMp.length ? "No package has “Activate MaxPlayer” — customers get only the XUI line" : withoutMp.length ? `Only some packages have MaxPlayer (${withMp.length} of ${packages.length})` : `All packages have MaxPlayer (${withMp.length})`,
      fix: <>Click “Turn on MaxPlayer for all packages” below — or open a package under <Link href="/dashboard/packages">Packages &amp; prices</Link>, tick “Activate MaxPlayer” and save.</>,
    },
  ];
  return (
    <>
      <PageHeader title="MaxPlayer.tv" description="Automatically create a MaxPlayer account with the customer's line credentials after each activation." />
      <Flash sp={sp} />
      {mp && (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${!mp.enabled ? "border-slate-300 dark:border-slate-700" : mp.testMode || !env.liveOperationsAllowed ? "border-brand-500 bg-brand-500/10" : "border-emerald-400/50 bg-emerald-400/10"}`}>
          <b>{!mp.enabled ? "MaxPlayer is switched off" : mp.testMode || !env.liveOperationsAllowed ? "Test mode — MaxPlayer accounts are only simulated, nothing is created on MaxPlayer" : "Live — MaxPlayer accounts are created for packages with “Activate MaxPlayer”"}</b>
          {mp.enabled && mp.testMode && <span className="block muted">Untick “Test mode” below and save.</span>}
          {mp.enabled && !env.liveOperationsAllowed && <span className="block muted">The server has ALLOW_LIVE_PANEL_OPERATIONS=false in .env.</span>}
          {mp.enabled && !mp.domainId && <span className="block text-rose-600">No MaxPlayer domain selected — accounts cannot be created.</span>}
        </div>
      )}
      <Card title={live ? "Diagnosis — everything is set for real MaxPlayer accounts" : "Diagnosis — why accounts may not be created"} className="mb-6">
        <ul className="space-y-2 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2">
              <span aria-hidden className={c.ok ? "text-emerald-600" : "text-rose-600"}>{c.ok ? "✓" : "✕"}</span>
              <span>{c.label}{!c.ok && c.fix && <span className="muted block text-xs">{c.fix}</span>}</span>
            </li>
          ))}
        </ul>
        {withoutMp.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-500/10 dark:text-rose-200">
            <span>Without MaxPlayer: <b>{withoutMp.map((p) => p.name).join(", ")}</b>. Customers of these packages (online purchase and activation codes) get only the XUI line.</span>
            {limits.allowMaxPlayer && <form action={enableMaxPlayerAllPackagesAction}><SubmitButton className="btn-primary btn-sm">Turn on MaxPlayer for all packages</SubmitButton></form>}
          </div>
        )}
        {waitingCount > 0 && (
          <div className="mt-4 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
            <b>{waitingCount} MaxPlayer account(s) are being created</b> — about {env.maxPlayerPerMinute} per minute, so MaxPlayer&apos;s request limit is not hit. Refresh in a minute to see progress.
            {limitNote && <span className="mt-1 block text-xs">{limitNote}</span>}
          </div>
        )}
        {notQueued > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <span>{notQueued} customer line(s) have no real MaxPlayer account yet (failed, waiting, only simulated in test mode, or made before their package had MaxPlayer).{!live && " Fix the red points above first, then the “Create them now” button appears."}</span>
            {live && <form action={createMissingMaxPlayerAction}><SubmitButton className="btn-primary btn-sm" confirm={`Create ${notQueued} MaxPlayer account(s) now with the customers' line username and password?`}>Create them now</SubmitButton></form>}
          </div>
        )}
        {calls.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium">Last MaxPlayer API calls</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {calls.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-3">
                  <span className="muted tabular-nums"><DateTime value={c.createdAt} /></span>
                  <span className="font-mono">{c.action}</span>
                  {c.success ? <span className="badge-green">ok {c.statusCode ?? ""}</span> : <span className="badge-red">failed {c.statusCode ?? ""}</span>}
                  {c.message && <span className="text-rose-600">{c.message}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      {!limits.allowMaxPlayer && <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">MaxPlayer is not included in your current plan. <Link href="/dashboard/billing">Upgrade</Link> to enable it.</div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2">Connection {mp && <StatusBadge status={mp.status} />}</span>} className="lg:col-span-2">
          <form action={saveMaxPlayerAction} className="space-y-4">
            <Field
              label="API token"
              name="apiKey"
              hint={
                mp ? (
                  <>
                    In use: <b className="font-mono">{storedKey}</b> — compare with MaxPlayer → API keys. To switch keys, paste the new one and Save (it is checked first; a refused key is not saved). Empty = keep this one.
                  </>
                ) : (
                  "MaxPlayer → API keys → create a key for this module (e.g. “OrbitModul”). Stored encrypted."
                )
              }
            >
              <input className="input font-mono" id="apiKey" name="apiKey" type="password" autoComplete="off" spellCheck={false} placeholder={mp ? `${storedKey} (unchanged)` : "mpk_…"} />
            </Field>
            <Field label="Domain for new customers" name="domainId" hint={domainError ? `Could not load domains: ${domainError}` : "Load the list with “Test connection”. This is the MaxPlayer domain_id the IPTV list will use."}>
              {domains.length ? (
                <select className="input" id="domainId" name="domainId" defaultValue={mp?.domainId ?? ""}>
                  <option value="">— select —</option>
                  {domains.map((d) => <option key={d.id} value={d.id}>{d.label} (#{d.id})</option>)}
                </select>
              ) : (
                <input className="input" id="domainId" name="domainId" defaultValue={mp?.domainId ?? ""} placeholder="domain_id" />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max devices (optional)" name="maxDevices"><input className="input" id="maxDevices" name="maxDevices" type="number" min={1} defaultValue={mp?.maxDevices ?? ""} /></Field>
              <Field label="Max profiles (optional)" name="maxProfiles"><input className="input" id="maxProfiles" name="maxProfiles" type="number" min={1} defaultValue={mp?.maxProfiles ?? ""} /></Field>
            </div>
            <div className="flex flex-wrap gap-6">
              <Toggle name="enabled" label="Enabled" defaultChecked={mp?.enabled ?? false} hint="Packages with “Activate MaxPlayer” will create accounts." />
              <Toggle name="testMode" label="Test mode" defaultChecked={mp?.testMode ?? true} hint="Simulate account creation." />
            </div>
            {!env.liveOperationsAllowed && <p className="hint">Platform test mode is active: MaxPlayer calls are simulated regardless of this setting.</p>}
            <div className="flex gap-2">
              <SubmitButton>Save</SubmitButton>
              {mp && <SubmitButton className="btn-secondary" formAction={testMaxPlayerAction}>Test connection</SubmitButton>}
            </div>
          </form>
          {mp?.lastError && <p className="mt-4 text-sm text-rose-600">Last error: {mp.lastError}</p>}
        </Card>
        <Card title="How it works">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>A customer pays and the XUI line is created.</li>
            <li>We look for an existing MaxPlayer customer with the same username; if none exists, we create one with the line&apos;s username and password.</li>
            <li>If MaxPlayer fails, the line and payment stay valid — you can retry below.</li>
          </ol>
          <p className="muted mt-3 text-xs">The documented MaxPlayer API has no expiry-extension endpoint; renewals keep the same credentials, so the app keeps working while the line is active.</p>
        </Card>
      </div>
      <Card title={`Activations — ${counts.active} active, ${counts.failed} failed`} pad={false} className="mt-6">
        {subs.length === 0 ? <Empty title="No MaxPlayer activations yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Customer</th><th>Line</th><th>MaxPlayer ID</th><th>Status</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/dashboard/subscriptions/${s.id}`}>{displayCustomer(s.customer.email, s.lineUsername)}</Link></td>
                    <td className="font-mono text-xs">{s.lineUsername}</td>
                    <td>{simulated(s.maxPlayerUserId) ? <span className="muted">— (simulated)</span> : s.maxPlayerUserId ?? "—"}</td>
                    <td>
                      {simulated(s.maxPlayerUserId) ? <span className="badge-amber">simulated (test mode)</span> : <StatusBadge status={s.maxPlayerStatus} />}
                      {s.isTest && <span className="badge-gray ml-1">test line</span>}
                      {s.maxPlayerError && <div className="max-w-xs whitespace-normal text-xs text-rose-600">{s.maxPlayerError}</div>}
                    </td>
                    <td><DateTime value={s.updatedAt} /></td>
                    <td className="text-right">
                      {(s.maxPlayerStatus !== "ACTIVE" || simulated(s.maxPlayerUserId)) && !s.isTest && (
                        <form action={retryMaxPlayerAction}>
                          <input type="hidden" name="subscriptionId" value={s.id} />
                          <SubmitButton className="btn-secondary btn-sm">{simulated(s.maxPlayerUserId) ? "Create real account" : "Retry"}</SubmitButton>
                        </form>
                      )}
                    </td>
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
