import { IMPORT_PACKAGE_NAME } from "@/core/importedCustomers";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { CopyButton, SubmitButton } from "@/components/client";
import { Card, DateTime, Empty, Field, Flash, PageHeader, Pagination } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { MAX_CODES_PER_BATCH } from "@/lib/codes";
import { db } from "@/lib/db";
import { storeBaseUrl } from "@/lib/urls";
import { createCodesAction, voidCodeAction } from "../actions/codes";

export const metadata = { title: "Activation codes" };

const PAGE = 100;

export default async function CodesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { reseller } = await requireReseller();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.ActivationCodeWhereInput = { resellerId: reseller.id };
  if (sp.package) where.packageId = sp.package;
  if (sp.batch) where.batch = sp.batch;
  if (sp.status === "UNUSED" || sp.status === "USED" || sp.status === "VOID") where.status = sp.status;
  const [packages, rows, counts] = await Promise.all([
    db.package.findMany({ where: { resellerId: reseller.id, name: { not: IMPORT_PACKAGE_NAME } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.activationCode.findMany({ where, include: { package: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 }),
    db.activationCode.groupBy({ by: ["status"], where: { resellerId: reseller.id }, _count: { _all: true } }),
  ]);
  const count = (s: string) => counts.find((c: { status: string }) => c.status === s)?._count._all ?? 0;
  const link = `${storeBaseUrl(reseller)}/activate`;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page" && k !== "ok" && k !== "error") as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Activation codes" description="Sell codes anywhere — your own website, PayPal, crypto, cash. The customer redeems the code on your activation link: a new line or an extension of their existing line, for the code's package." />
      <Flash sp={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your universal activation link" className="lg:col-span-2">
          <div className="flex items-center gap-2"><code className="flex-1 break-all text-sm">{link}</code><CopyButton text={link} /></div>
          <p className="muted mt-3 text-sm">Put it as the “after payment / thank-you” page in your shop or send it to the customer together with the code. With the code in the link the customer does not have to type it:</p>
          <code className="mt-1 block break-all text-xs">{link}?code=XXXX-XXXX-XXXX</code>
          <p className="hint mt-3">Each code works once. A 1-month code gives a 1-month line or adds 1 month to an existing line (the panel package linked to the code's package).</p>
          <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
            <li className="rounded-lg border border-[color:var(--line)] p-3"><b className="text-[color:var(--accent-strong)]">1. Customer pays</b><br /><span className="muted">on your website, Sellix, PayPal, crypto or cash</span></li>
            <li className="rounded-lg border border-[color:var(--line)] p-3"><b className="text-[color:var(--accent-strong)]">2. Gets the code</b><br /><span className="muted">delivered by your shop, or you send the <i>Copy link</i> of a code below</span></li>
            <li className="rounded-lg border border-[color:var(--line)] p-3"><b className="text-[color:var(--accent-strong)]">3. Opens the link</b><br /><span className="muted">New line: chooses a username + email · Extend: username or email</span></li>
            <li className="rounded-lg border border-[color:var(--line)] p-3"><b className="text-[color:var(--accent-strong)]">4. Line is ready</b><br /><span className="muted">username, password and app guide on screen and by email (from your mailbox)</span></li>
          </ol>
        </Card>
        <Card title="Codes">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="muted">Unused</dt><dd><b>{count("UNUSED")}</b></dd></div>
            <div className="flex justify-between"><dt className="muted">Used</dt><dd>{count("USED")}</dd></div>
            <div className="flex justify-between"><dt className="muted">Voided</dt><dd>{count("VOID")}</dd></div>
          </dl>
        </Card>
        <Card title="Create codes" className="lg:col-span-3">
          {packages.length === 0 ? (
            <p className="muted">Create a package first: <Link href="/dashboard/packages/new">New package</Link>.</p>
          ) : (
            <form action={createCodesAction} className="grid gap-4 sm:grid-cols-4 sm:items-end">
              <Field label="Package" name="packageId">
                <select className="input" id="packageId" name="packageId">{packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.durationDays} days{p.maxPlayerEnabled ? " · with MaxPlayer" : " · without MaxPlayer"}</option>)}</select>
              </Field>
              <Field label={`How many (max ${MAX_CODES_PER_BATCH})`} name="count">
                <input className="input" id="count" name="count" type="number" min={1} max={MAX_CODES_PER_BATCH} defaultValue={10} required />
              </Field>
              <Field label="Batch name (optional)" name="batch">
                <input className="input" id="batch" name="batch" maxLength={60} placeholder="e.g. Sellix October" />
              </Field>
              <SubmitButton>Create codes</SubmitButton>
            </form>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          pad={false}
          title="All codes"
          actions={<a className="btn-secondary btn-sm" href={`/dashboard/codes/export${qs ? `?${qs}` : ""}`}>Download CSV</a>}
        >
          <form className="flex flex-wrap gap-2 border-b border-slate-100 p-4 dark:border-slate-800">
            <select className="input max-w-xs" name="package" defaultValue={sp.package ?? ""}>
              <option value="">All packages</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input max-w-[10rem]" name="status" defaultValue={sp.status ?? ""}>
              <option value="">All statuses</option>
              <option value="UNUSED">Unused</option>
              <option value="USED">Used</option>
              <option value="VOID">Voided</option>
            </select>
            <input className="input max-w-xs" name="batch" defaultValue={sp.batch ?? ""} placeholder="Batch" />
            <button className="btn-secondary">Filter</button>
          </form>
          {rows.length === 0 ? <Empty title="No codes yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Code</th><th>Activation link</th><th>Package</th><th>Status</th><th>Batch</th><th>Used</th><th>Line</th><th></th></tr></thead>
                <tbody>
                  {rows.slice(0, PAGE).map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-sm"><span className="select-all">{c.code}</span></td>
                      <td>
                        {c.status === "UNUSED" ? (
                          <span className="flex items-center gap-1.5">
                            <CopyButton text={`${link}?code=${c.code}`} label="Copy link" />
                            <a href={`${link}?code=${c.code}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm" title={`${link}?code=${c.code}`}>Open ↗</a>
                          </span>
                        ) : <span className="muted text-xs">—</span>}
                      </td>
                      <td>{c.package.name}</td>
                      <td>{c.status === "UNUSED" ? <span className="badge-green">unused</span> : c.status === "USED" ? <span className="badge-gray">used</span> : <span className="badge-red">voided</span>}</td>
                      <td className="muted text-xs">{c.batch ?? "—"}</td>
                      <td className="text-xs">{c.usedAt ? <DateTime value={c.usedAt} /> : "—"}</td>
                      <td className="font-mono text-xs">{c.subscriptionId ? <Link href={`/dashboard/subscriptions/${c.subscriptionId}`}>{c.lineUsername ?? "line"}</Link> : c.orderId ? <Link href={`/dashboard/orders/${c.orderId}`}>{c.lineUsername ?? "order"}</Link> : "—"}</td>
                      <td className="text-right">
                        {c.status === "UNUSED" && (
                          <form action={voidCodeAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="back" value={`/dashboard/codes${qs ? `?${qs}` : ""}`} />
                            <SubmitButton className="btn-ghost btn-sm text-rose-600" confirm={`Void ${c.code}? It can no longer be used.`}>Void</SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} hasMore={rows.length > PAGE} baseHref={`/dashboard/codes?${qs}`} />
        </Card>
      </div>
    </>
  );
}
