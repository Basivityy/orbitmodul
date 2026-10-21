import { notFound, redirect } from "next/navigation";
import type { PackageSnapshot } from "@/core/activation/engine";
import { SubmitButton } from "@/components/client";
import { Flash, Money } from "@/components/ui";
import { db } from "@/lib/db";
import { storeTestPaymentsEnabled } from "@/lib/settings";
import { resolveStore } from "@/lib/storefront";
import { storeTestPayAction } from "../../actions";

export const metadata = { title: "Test payment" };
export const dynamic = "force-dynamic";

/** Simulated payment provider page (store test mode). Looks like a card form; nothing is charged. */
export default async function StoreTestPayPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const { reseller, base } = await resolveStore(slug);
  if (!(await storeTestPaymentsEnabled())) notFound();
  const o = await db.order.findFirst({ where: { accessToken: token, resellerId: reseller.id, provider: "TEST" }, include: { customer: true } });
  if (!o) notFound();
  if (o.status !== "PENDING") redirect(`${base}/order/${o.accessToken}`);
  const snap = o.packageSnapshot as unknown as PackageSnapshot;
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
        TEST MODE — this is a simulated payment. No money is charged.
      </div>
      <div className="card card-pad sm:p-8">
        <div className="mb-5 flex items-baseline justify-between">
          <div>
            <div className="muted text-xs">{reseller.storeName}</div>
            <div className="font-semibold">{snap.name}</div>
          </div>
          <div className="text-2xl font-bold"><Money amount={o.amountCents} currency={o.currency} /></div>
        </div>
        <Flash sp={sp} />
        <form action={storeTestPayAction} className="space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="token" value={token} />
          <div>
            <label className="label">Email</label>
            <input className="input" value={o.customer.email} readOnly />
          </div>
          <div>
            <label className="label">Card number (test)</label>
            <input className="input font-mono" defaultValue="4242 4242 4242 4242" readOnly />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Expiry</label><input className="input font-mono" defaultValue="12 / 34" readOnly /></div>
            <div><label className="label">CVC</label><input className="input font-mono" defaultValue="123" readOnly /></div>
          </div>
          <SubmitButton name="outcome" value="pay" className="btn w-full py-3 text-base text-white" style={{ background: "var(--brand)" }}>Pay <Money amount={o.amountCents} currency={o.currency} /></SubmitButton>
          <SubmitButton name="outcome" value="fail" className="btn-ghost w-full text-sm">Simulate a failed payment</SubmitButton>
        </form>
      </div>
    </div>
  );
}
