import Link from "next/link";
import { notFound } from "next/navigation";
import type { PackageSnapshot } from "@/core/activation/engine";
import { decrypt } from "@/core/crypto";
import { AutoRefresh, CopyButton } from "@/components/client";
import { DateTime, Money } from "@/components/ui";
import { db } from "@/lib/db";
import { loadGateway } from "@/lib/gateways";
import { handlePaymentEvents } from "@/lib/orders";
import { resolveStore } from "@/lib/storefront";
import { cookies } from "next/headers";
import { pickLang, t, type CodeKey, type Lang } from "@/core/i18n/codeFlow";
import { AppGuideCard } from "@/components/AppGuideCard";
import { appIconUrl, getAppGuide } from "@/lib/appGuide";

export const metadata = { title: "Your order" };
export const dynamic = "force-dynamic";

const CREDENTIALS_WINDOW_MS = 24 * 3600 * 1000;

export default async function OrderStatusPage({ params, searchParams }: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug, token }, sp] = await Promise.all([params, searchParams]);
  const { reseller, base } = await resolveStore(slug);
  let order = await db.order.findFirst({ where: { accessToken: token, resellerId: reseller.id }, include: { subscription: true } });
  if (!order) notFound();

  // Buyer returned from the provider before the webhook arrived: confirm server-side (idempotent).
  if (order.status === "PENDING" && (order.provider === "PAYPAL" || order.provider === "MOLLIE")) {
    try {
      const gw = await loadGateway(reseller.id, order.provider);
      if (gw?.impl.confirmReturn) {
        const events = await gw.impl.confirmReturn(gw.creds, order.provider === "PAYPAL" ? { token: sp.token ?? order.providerRef ?? "" } : { paymentId: order.providerRef ?? "" }, gw.opts);
        if (events.length) await handlePaymentEvents(reseller.id, order.provider, events);
        order = await db.order.findFirstOrThrow({ where: { id: order.id }, include: { subscription: true } });
      }
    } catch (e) {
      console.error("[order] confirmReturn failed", (e as Error).message);
    }
  }

  const snap = order.packageSnapshot as unknown as PackageSnapshot;
  const sub = order.subscription;
  const inProgress = ["PENDING", "PAID", "ACTIVATING"].includes(order.status);
  const guide = await getAppGuide();
  const mp = snap.maxPlayerEnabled ? await db.maxPlayerIntegration.findUnique({ where: { resellerId: reseller.id }, select: { enabled: true } }) : null;
  const showGuide = guide.enabled && Boolean(mp?.enabled);
  // Orders from activation codes are shown in the customer's language (BHS by default).
  const isCode = !!order.providerPaymentId?.startsWith("code-");
  const lang: Lang = isCode ? pickLang(sp.lang, (await cookies()).get("lang")?.value) : "en";
  const L = (key: CodeKey, original: string) => (isCode ? t(lang, key) : original);
  const showCredentials = order.status === "COMPLETED" && sub?.lineUsername && sub.linePasswordEnc && order.activatedAt && Date.now() - order.activatedAt.getTime() < CREDENTIALS_WINDOW_MS;

  return (
    <div className="mx-auto max-w-xl">
      <AutoRefresh active={inProgress} />
      <div className="card card-pad text-center sm:p-8">
        {order.status === "COMPLETED" ? (
          <>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">✓</div>
            <h1>{order.kind === "RENEWAL" ? L("extended", "Subscription extended") : L("active", "Your subscription is active")}</h1>
          </>
        ) : inProgress ? (
          <>
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[color:var(--brand)]" />
            <h1>{order.status === "PENDING" ? "Waiting for payment confirmation…" : L("activating", "Payment received — activating…")}</h1>
            <p className="muted mt-2">{L("activatingSub", "This usually takes a few seconds. This page updates automatically.")}</p>
          </>
        ) : order.status === "FAILED" || order.status === "CANCELED" ? (
          <>
            <h1>Payment not completed</h1>
            <p className="muted mt-2">No money was taken for this order. <Link href={`${base}/checkout/${order.packageId}`}>Try again</Link></p>
          </>
        ) : (
          <>
            <h1>{L("manual", "We received your payment")}</h1>
            <p className="muted mt-2">{L("manualSub", "Your activation needs a manual check by the store. You will receive an email as soon as it is ready. Reference:")} <b>{order.number}</b></p>
          </>
        )}

        <dl className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
          <div className="flex justify-between"><dt className="muted">{L("order", "Order")}</dt><dd className="font-mono">{order.number}</dd></div>
          <div className="flex justify-between"><dt className="muted">{L("package", "Package")}</dt><dd>{snap.name}</dd></div>
          <div className="flex justify-between"><dt className="muted">{isCode ? t(lang, "paidWith") : "Amount"}</dt><dd>{isCode ? t(lang, "activationCode") : <Money amount={order.amountCents} currency={order.currency} />}</dd></div>
          {sub?.expiresAt && order.status === "COMPLETED" && <div className="flex justify-between"><dt className="muted">{L("validUntil", "Valid until")}</dt><dd><DateTime value={sub.expiresAt} /></dd></div>}
        </dl>

        {showCredentials && sub && showGuide && (
          <div className="mx-auto mt-6 max-w-md">
            <AppGuideCard guide={guide} iconUrl={appIconUrl(guide)} username={sub.lineUsername!} password={decrypt(sub.linePasswordEnc!)} lang={lang} />
            <p className="hint mt-2">{L("emailed", "We also emailed these to you. You can view them later in")} <Link href={`${base}/portal`}>{L("yourAccount", "your account")}</Link>.</p>
          </div>
        )}
        {showCredentials && sub && !showGuide && (
          <div className="mx-auto mt-6 max-w-sm rounded-xl border border-slate-200 p-4 text-left dark:border-slate-700">
            <div className="mb-2 text-sm font-semibold">{L("yourAccess", "Your access details")}</div>
            <div className="flex items-center justify-between gap-2 py-1 text-sm"><span className="muted">{L("username", "Username")}</span><code className="select-all">{sub.lineUsername}</code><CopyButton text={sub.lineUsername!} /></div>
            <div className="flex items-center justify-between gap-2 py-1 text-sm"><span className="muted">{L("password", "Password")}</span><code className="select-all">{decrypt(sub.linePasswordEnc!)}</code><CopyButton text={decrypt(sub.linePasswordEnc!)} /></div>
            <p className="hint mt-2">{L("emailed", "We also emailed these to you. You can view them later in")} <Link href={`${base}/portal`}>{L("yourAccount", "your account")}</Link>.</p>
          </div>
        )}
        {order.status === "COMPLETED" && !showCredentials && (
          <p className="muted mt-6">{L("emailedOnly", "Your access details were emailed to you and are available in")} <Link href={`${base}/portal`}>{L("yourAccount", "your account")}</Link>.</p>
        )}
      </div>
    </div>
  );
}
