import Link from "next/link";
import { CopyButton } from "@/components/client";
import { Card, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { storeBaseUrl } from "@/lib/urls";

export const metadata = { title: "App API" };

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{children}</pre>;
}

export default async function AppApiPage() {
  const { reseller } = await requireReseller();
  const panels = await db.panelIntegration.findMany({ where: { resellerId: reseller.id }, select: { id: true, name: true, streamUrl: true } });
  const api = `${env.appUrl}/api/app/v1`;
  const store = reseller.slug;
  const missingDns = panels.filter((p) => !p.streamUrl);
  return (
    <>
      <PageHeader
        title="App API"
        description="Build your own IPTV app on top of this platform: the customer types only the code they bought — the app receives server, username and password automatically. All calls are open to your app; no API key is needed (the code is the key)."
        actions={<a className="btn-primary" href="/dashboard/app-api/template">Download app template</a>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your settings" className="lg:col-span-2">
          <dl className="space-y-3 text-sm">
            <div><dt className="muted">API address</dt><dd className="flex items-center gap-2"><code className="flex-1 break-all">{api}</code><CopyButton text={api} /></dd></div>
            <div><dt className="muted">Your store id (<code>store</code>) — your app accepts only your codes</dt><dd className="flex items-center gap-2"><code className="flex-1">{store}</code><CopyButton text={store} /></dd></div>
            <div><dt className="muted">Where customers buy / extend</dt><dd><code className="break-all">{storeBaseUrl(reseller)}/activate</code></dd></div>
          </dl>
          {missingDns.length > 0 && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              Set the <b>Streaming URL / DNS</b> on {missingDns.map((p) => <Link key={p.id} href={`/dashboard/panels/${p.id}`} className="mr-1">{p.name}</Link>)} — that is the server address your app receives.
            </p>
          )}
        </Card>
        <Card title="How it works">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Customer buys a code (<Link href="/dashboard/codes">Activation codes</Link>).</li>
            <li>Types it into your app → <code>activate</code> creates the line (username and password are generated).</li>
            <li>The same code signs in on other devices — up to the package's connections. Reset devices on the subscription page.</li>
            <li>New code → <code>extend</code> → the same line gets the time.</li>
          </ol>
        </Card>
      </div>

      <div className="mt-6 space-y-6">
        <Card title="1. POST /activate — activate a code or sign in">
          <p className="mb-3 text-sm">Send the code the customer typed. New code → the line is created and the answer is <code>"activating"</code>: call again every 3 seconds until <code>"active"</code>. A code that already activated a line → signs in (also on a new device). Save the code in the app — it is the customer's login.</p>
          <Code>{`POST ${api}/activate
Content-Type: application/json

{
  "code": "A7K2-9QXM-4TPL",
  "deviceId": "android-3f9c2a7d41b0",   // stable per device (ANDROID_ID, UUID, MAC)
  "deviceName": "Samsung TV living room", // optional, shown to you
  "store": "${store}"                      // optional: accept only your codes
}`}</Code>
          <p className="my-3 text-sm">Answer when the line is ready:</p>
          <Code>{`{
  "status": "active",                 // active | expired | activating | extending
  "server": "http://line.yourdomain.com:80",
  "username": "u7k2q9xm",
  "password": "Xk92hdA1",
  "expiresAt": "2026-11-12T08:17:45.000Z",
  "maxConnections": 1,
  "devices": { "used": 1, "limit": 1 },
  "store": { "name": "${reseller.storeName}", "extendUrl": "${storeBaseUrl(reseller)}/activate?mode=extend", "contact": ${JSON.stringify(reseller.contactEmail ?? null)} }
}`}</Code>
        </Card>

        <Card title="2. POST /status — on every app start">
          <p className="mb-3 text-sm">Refreshes the details (new expiry after an extension, expired or not). Use the saved login code. Never creates anything.</p>
          <Code>{`POST ${api}/status
{ "loginCode": "A7K2-9QXM-4TPL", "deviceId": "android-3f9c2a7d41b0", "store": "${store}" }`}</Code>
        </Card>

        <Card title="3. POST /extend — add a new code to the same line">
          <p className="mb-3 text-sm">The customer types the new code in the app. Answer <code>"extending"</code> → call <code>/status</code> every 3 seconds until it is <code>"active"</code> with the new <code>expiresAt</code>.</p>
          <Code>{`POST ${api}/extend
{ "loginCode": "A7K2-9QXM-4TPL", "code": "Q4MN-7TPX-2HCW", "deviceId": "android-3f9c2a7d41b0", "store": "${store}" }`}</Code>
        </Card>

        <Card title="Errors">
          <p className="mb-3 text-sm">Every error has the same shape; show <code>message</code> to the customer.</p>
          <Code>{`{ "status": "error", "error": "device_limit", "message": "This code is already used on 1 device. Ask the store to reset your devices." }`}</Code>
          <div className="table-wrap mt-3">
            <table className="table text-sm">
              <thead><tr><th>HTTP</th><th>error</th><th>Meaning</th></tr></thead>
              <tbody>
                <tr><td>400</td><td><code>invalid_code</code> / <code>invalid_device</code></td><td>Wrong code format / missing deviceId</td></tr>
                <tr><td>404</td><td><code>unknown_code</code></td><td>Code does not exist (or belongs to another store)</td></tr>
                <tr><td>403</td><td><code>device_limit</code></td><td>Code used on too many devices — reset on the subscription page</td></tr>
                <tr><td>403</td><td><code>unknown_device</code></td><td>Call /activate on this device first</td></tr>
                <tr><td>409</td><td><code>extension_code</code></td><td>This code was used to extend — sign in with the first code</td></tr>
                <tr><td>409</td><td><code>redeem_failed</code> / <code>activation_problem</code></td><td>Code already used, line could not be created — contact store</td></tr>
                <tr><td>403</td><td><code>store_inactive</code></td><td>Store is suspended or its plan expired</td></tr>
                <tr><td>429</td><td><code>rate_limited</code></td><td>Too many attempts — wait a few minutes</td></tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Playing the channels (Xtream Codes)">
          <p className="mb-3 text-sm">With <code>server</code>, <code>username</code> and <code>password</code> your player uses the standard Xtream Codes API of your panel:</p>
          <Code>{`Categories / channels:  {server}/player_api.php?username={u}&password={p}&action=get_live_categories
                        {server}/player_api.php?username={u}&password={p}&action=get_live_streams
VOD / series:           ...&action=get_vod_streams   ...&action=get_series
Live stream:            {server}/live/{u}/{p}/{stream_id}.ts   (or .m3u8)
M3U playlist:           {server}/get.php?username={u}&password={p}&type=m3u_plus&output=ts`}</Code>
        </Card>

        <Card title="Test with curl">
          <Code>{`curl -s -X POST ${api}/activate -H "Content-Type: application/json" \\
  -d '{"code":"YOUR-CODE-HERE","deviceId":"test-device-001","store":"${store}"}'`}</Code>
          <p className="hint mt-2">The template (button at the top) is a complete working app in one HTML file: code login, auto-refresh, extend, sign out. Open it in a browser to try; use it as the base for Android/iOS (WebView), Samsung Tizen and LG webOS apps and plug your player into <code>play()</code>.</p>
        </Card>
      </div>
    </>
  );
}
