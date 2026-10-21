import Link from "next/link";
import { effectivePrice } from "@/core/pricing";
import { makeRenewToken, verifyRenewToken } from "@/core/renewToken";
import { maskUsername } from "@/core/usernames";
import { SubmitButton } from "@/components/client";
import { DateTime, Flash, Money } from "@/components/ui";
import { db } from "@/lib/db";
import { resolveStore } from "@/lib/storefront";
import { packageSellable } from "@/core/catalog";
import { lookupLineAction } from "../actions";

export const metadata = { title: "Extend your line" };
export const dynamic = "force-dynamic";

function durationLabel(days: number) {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0) return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

export default async function RenewPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { reseller, base, canSell } = await resolveStore(slug);
  const sub = sp.line && verifyRenewToken(sp.line, sp.t) ? await db.subscription.findFirst({ where: { id: sp.line, resellerId: reseller.id } }) : null;

  // Found by email: list the customer's lines (usernames partly hidden — anyone can type an email).
  if (!sub && sp.c && verifyRenewToken(`cust:${sp.c}`, sp.t)) {
    const lines = await db.subscription.findMany({ where: { customerId: sp.c, resellerId: reseller.id, xuiLineId: { not: null } }, orderBy: { expiresAt: "desc" } });
    return (
      <div className="mx-auto max-w-xl">
        <div className="card card-pad sm:p-8">
          <h1 className="mb-1">Your lines</h1>
          <p className="muted mb-6">Choose the line you want to extend.</p>
          <ul className="space-y-3">
            {lines.map((l) => {
              const expired = !l.expiresAt || l.expiresAt < new Date();
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div>
                    <div className="font-mono font-semibold">{maskUsername(l.lineUsername ?? "")}</div>
                    <div className="muted text-sm">{expired ? "Expired" : "Valid until"} {l.expiresAt ? <DateTime value={l.expiresAt} dateOnly /> : "—"}</div>
                  </div>
                  <Link className="btn text-white" style={{ background: "var(--brand)" }} href={`${base}/renew?line=${l.id}&t=${encodeURIComponent(makeRenewToken(l.id))}`}>Extend</Link>
                </li>
              );
            })}
          </ul>
          <p className="hint mt-4">Your full username and password are in your purchase emails and in <Link href={`${base}/portal`}>My account</Link>.</p>
        </div>
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card card-pad sm:p-8">
          <h1 className="mb-1">Extend your line</h1>
          <p className="muted mb-6">Already a customer? Enter the <b>email</b> you used to buy, or the <b>username</b> you use in the app.</p>
          <Flash sp={sp} />
          <form action={lookupLineAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input className="input" name="account" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="email or username" maxLength={254} />
            <SubmitButton className="btn w-full text-white" style={{ background: "var(--brand)" }}>Find my line</SubmitButton>
          </form>
          <p className="hint mt-4">New customer? <Link href={`${base}#packages`}>Buy a new line</Link></p>
        </div>
      </div>
    );
  }

  const packages = (await db.package.findMany({ where: { resellerId: reseller.id, active: true, panelId: sub.panelId }, include: { panel: { select: { apiUrl: true } } }, orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }] })).filter(packageSellable);
  const expired = !sub.expiresAt || sub.expiresAt < new Date();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="card card-pad mb-8 text-center sm:p-8">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">✓</div>
        <h1>We found your subscription</h1>
        <dl className="mx-auto mt-5 max-w-xs space-y-2 text-left text-sm">
          <div className="flex justify-between"><dt className="muted">Username</dt><dd className="font-mono">{sub.lineUsername}</dd></div>
          <div className="flex justify-between"><dt className="muted">{expired ? "Expired on" : "Valid until"}</dt><dd>{sub.expiresAt ? <DateTime value={sub.expiresAt} dateOnly /> : "—"}</dd></div>
        </dl>
        <p className="muted mt-4 text-sm">Choose how long to extend. {expired ? "Your line is reactivated" : "The time is added to your current expiry date"} right after payment — your username and password stay the same.</p>
      </div>
      {!canSell ? (
        <p className="muted text-center">This store is not accepting payments right now.</p>
      ) : packages.length === 0 ? (
        <p className="muted text-center">No renewal options are available right now. Please contact the store.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {packages.map((p) => {
            const price = effectivePrice(p);
            return (
              <div key={p.id} className="card flex items-center justify-between gap-4 p-5">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="muted text-sm">+ {durationLabel(p.durationDays)}</div>
                  <div className="mt-1 text-xl font-bold" style={{ color: "var(--brand)" }}><Money amount={price.amount} currency={p.currency} /></div>
                </div>
                <Link className="btn text-white" style={{ background: "var(--brand)" }} href={`${base}/checkout/${p.id}?line=${sub.id}&t=${encodeURIComponent(sp.t)}`}>Extend</Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
