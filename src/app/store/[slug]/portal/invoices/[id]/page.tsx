import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/client";
import { DateTime, Money } from "@/components/ui";
import { getCurrentCustomer } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveStore } from "@/lib/storefront";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { reseller, base } = await resolveStore(slug);
  const customer = await getCurrentCustomer(reseller.id);
  if (!customer) redirect(`${base}/portal`);
  const inv = await db.invoice.findFirst({ where: { id, customerId: customer.id, resellerId: reseller.id }, include: { order: true } });
  if (!inv) notFound();
  const lines = (inv.lines as Array<{ description: string; amount: number }>) ?? [];
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="card p-8 print:border-0 print:shadow-none">
        <div className="mb-8 flex justify-between">
          <div>
            <h1 className="text-xl">{reseller.storeName}</h1>
            {reseller.contactEmail && <p className="muted">{reseller.contactEmail}</p>}
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold">INVOICE</div>
            <div className="font-mono text-sm">{inv.number}</div>
            <div className="muted text-sm"><DateTime value={inv.issuedAt} dateOnly /></div>
          </div>
        </div>
        <div className="mb-6 text-sm">
          <div className="muted">Billed to</div>
          <div>{customer.name ?? ""} {customer.email}</div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-200 text-left dark:border-slate-700"><th className="py-2">Description</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {lines.map((l, i) => <tr key={i} className="border-b border-slate-100 dark:border-slate-800"><td className="py-2">{l.description}</td><td className="py-2 text-right"><Money amount={l.amount} currency={inv.currency} /></td></tr>)}
          </tbody>
          <tfoot><tr><td className="pt-4 font-semibold">Total paid</td><td className="pt-4 text-right text-lg font-semibold"><Money amount={inv.amountCents} currency={inv.currency} /></td></tr></tfoot>
        </table>
        <p className="muted mt-8 text-xs">Order {inv.order.number} · paid via {inv.order.provider.toLowerCase()}{inv.order.status === "REFUNDED" ? " · REFUNDED" : ""}</p>
      </div>
    </div>
  );
}
