import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { env } from "@/lib/env";

export const metadata = { title: "Website API documentation" };
export const dynamic = "force-dynamic";

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-xs leading-relaxed dark:bg-slate-900">{children}</pre>;
}

const ENDPOINTS: Array<[string, string, string]> = [
  ["GET", "/ping", "Checks your key → { ok, store, currency }"],
  ["GET", "/packages", "Packages on sale: id, name, price_minor, currency, duration_days, connections, bouquets[]"],
  ["GET", "/usernames/{username}", "{ available, reason? } — 8–30 letters and digits, at least one of each"],
  ["POST", "/lines", "New line. Body: package_id, username?, email?, name?, note?, amount? | amount_minor?, external_ref?, send_email?, wait?"],
  ["POST", "/lines/extend", "Extend a line. Body: line_id | username, package_id, email?, amount? | amount_minor?, external_ref?, wait?"],
  ["GET", "/orders/{id | number | external_ref}", "Order status: pending · activating · completed · failed; line with login details once completed"],
  ["GET", "/lines?username=… | ?email=…", "Find lines → { lines: [ … ] }"],
  ["GET", "/lines/{id}", "One line: username, password, server_url, status, expires_at, package, customer"],
  ["POST", "/codes", "Activation codes. Body: package_id, count (1–500), batch?"],
  ["GET", "/codes/{code}", "Code status: unused · used · void, and for which line"],
];

export default async function DocsPage() {
  const { reseller } = await requireReseller();
  const base = `${env.appUrl.replace(/\/+$/, "")}/api/partner/v1`;
  return (
    <>
      <PageHeader title="Website API documentation" description={<>For the developer of your website. <Link href="/dashboard/website-api">← Keys, webhook &amp; widget</Link></>} />
      <div className="space-y-6">
        <Card title="Basics">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Base URL: <code className="select-all">{base}</code></li>
            <li>Every request: header <code>Authorization: Bearer om_live_…</code> (your key). JSON in and out.</li>
            <li><b>Server to server only</b> — never put the key into HTML or JavaScript that runs in the visitor&apos;s browser. For a site without a backend use the widget.</li>
            <li>Payment happens on your website: a call with a valid key counts as <b>paid</b>. <code>amount</code> is only recorded for your statistics (default: package price).</li>
            <li><code>external_ref</code> = your own order number. Sending the same one again returns the same order — safe to retry after a timeout, nothing is created twice.</li>
            <li><code>wait</code> (seconds, max 25): the answer waits until the line is ready. Without it you get <code>status: &quot;activating&quot;</code> and ask <code>GET /orders/…</code> again (or use the webhook).</li>
            <li>Errors: HTTP 4xx/5xx with <code>{`{ "error": "code", "message": "…" }`}</code>. Limit: 240 requests per minute per key.</li>
          </ul>
        </Card>
        <Card title="Endpoints" pad={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead>
              <tbody>{ENDPOINTS.map(([m, p, d]) => <tr key={m + p}><td className="font-mono text-xs">{m}</td><td className="font-mono text-xs">{p}</td><td className="text-sm">{d}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>
        <Card title="Example: new line after a paid order">
          <Code>{`curl -X POST ${base}/lines \\
  -H "Authorization: Bearer om_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"package_id":"PACKAGE_ID","username":"marko2026","email":"marko@example.com","external_ref":"woo-1234","wait":20}'`}</Code>
          <p className="mt-3 text-sm">Answer (shortened):</p>
          <Code>{`{
  "id": "clx…", "number": "API-…", "type": "new", "status": "completed", "external_ref": "woo-1234",
  "line": {
    "id": "clx…", "username": "marko2026", "password": "p8Eh…", "server_url": "http://line.example.com:80",
    "status": "active", "expires_at": "2026-11-26T10:00:00.000Z",
    "package": { "id": "…", "name": "1 Month" }, "customer": { "email": "marko@example.com" }
  }
}`}</Code>
          <p className="hint mt-2">Without <code>username</code> one is generated. With an email the customer also gets the login details email from {reseller.storeName} (<code>&quot;send_email&quot;: false</code> to skip).</p>
        </Card>
        <Card title="Example: extend by username">
          <Code>{`curl -X POST ${base}/lines/extend \\
  -H "Authorization: Bearer om_live_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"username":"marko2026","package_id":"PACKAGE_ID","external_ref":"woo-1250","wait":20}'`}</Code>
          <p className="hint mt-2">Lines that exist only on the panel must be in billing first (Customers → Load existing line / Import all my lines).</p>
        </Card>
        <Card title="Webhook">
          <p className="mb-2 text-sm">Events: <code>line.created</code>, <code>line.extended</code>, <code>activation.failed</code>, <code>line.expiring</code> (3 days before), <code>ping</code> (test). Body:</p>
          <Code>{`{ "id": "evt_…", "event": "line.created", "created": "2026-10-26T10:00:00Z",
  "data": { "order_id": "…", "order_number": "API-…", "external_ref": "woo-1234", "line_id": "…", "line": { …same as GET /lines/{id}… } } }`}</Code>
          <p className="mb-2 mt-3 text-sm">Check the signature (header <code>X-OrbitModul-Signature: t=…,v1=…</code>) — PHP example:</p>
          <Code>{`<?php
$secret = 'whsec_…';                       // from the dashboard
$body   = file_get_contents('php://input');
parse_str(str_replace(',', '&', $_SERVER['HTTP_X_ORBITMODUL_SIGNATURE'] ?? ''), $sig);
$expected = hash_hmac('sha256', $sig['t'] . '.' . $body, $secret);
if (!hash_equals($expected, $sig['v1'] ?? '') || abs(time() - (int)$sig['t']) > 300) { http_response_code(400); exit; }
$event = json_decode($body, true);
// … e.g. $event['event'] === 'line.created' → show $event['data']['line'] to the customer
http_response_code(200);`}</Code>
          <p className="hint mt-2">Answer 2xx within 10 seconds. Failed deliveries are retried for about a day.</p>
        </Card>
      </div>
    </>
  );
}
