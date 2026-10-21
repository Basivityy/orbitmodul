import { notFound } from "next/navigation";
import type { PackageSnapshot } from "@/core/activation/engine";
import { SubmitButton } from "@/components/client";
import { Card, Flash, Money, PageHeader, StatusBadge } from "@/components/ui";
import { requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderStatusLabel } from "@/lib/orders";
import { completeTestPaymentAction } from "../../actions/orders";

export const metadata = { title: "Test payment" };

export default async function TestPayPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ orderId }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await requireReseller();
  const o = await db.order.findFirst({ where: { id: orderId, resellerId: reseller.id, provider: "TEST" }, include: { customer: true } });
  if (!o) notFound();
  const snap = o.packageSnapshot as unknown as PackageSnapshot;
  return (
    <>
      <PageHeader title="Test payment" description="Simulates the payment provider. Only you can see this page." />
      <Flash sp={sp} />
      <Card className="max-w-lg">
        <dl className="mb-6 space-y-2 text-sm">
          <div className="flex justify-between"><dt className="muted">Order</dt><dd className="font-mono">{o.number}</dd></div>
          <div className="flex justify-between"><dt className="muted">Customer</dt><dd>{o.customer.email}</dd></div>
          <div className="flex justify-between"><dt className="muted">Package</dt><dd>{snap.name}</dd></div>
          <div className="flex justify-between"><dt className="muted">Amount</dt><dd><Money amount={o.amountCents} currency={o.currency} /></dd></div>
          <div className="flex justify-between"><dt className="muted">Status</dt><dd><StatusBadge status={o.status} label={orderStatusLabel[o.status]} /></dd></div>
        </dl>
        {o.status === "PENDING" ? (
          <form action={completeTestPaymentAction} className="flex gap-2">
            <input type="hidden" name="orderId" value={o.id} />
            <SubmitButton name="outcome" value="pay" className="btn-primary flex-1">Simulate successful payment</SubmitButton>
            <SubmitButton name="outcome" value="fail" className="btn-secondary">Simulate failure</SubmitButton>
          </form>
        ) : (
          <p className="muted">This test order is no longer awaiting payment.</p>
        )}
      </Card>
    </>
  );
}
