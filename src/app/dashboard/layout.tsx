import Link from "next/link";
import { Shell, NavItem } from "@/components/Shell";
import { SubmitButton } from "@/components/client";
import { requireReseller } from "@/lib/auth";
import { env } from "@/lib/env";
import { loadResellerSaas, saasActive } from "@/lib/saas";
import { platformBillingEnabled, resellerPlansEnabled } from "@/lib/settings";
import { dismissAnnouncementAction, resendVerificationAction } from "./actions/account";
import { AnnouncementCard } from "@/components/AnnouncementCard";
import { dashboardAnnouncements } from "@/lib/announcements";

export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "◎", exact: true },
  { href: "/dashboard/stats", label: "Statistics", icon: "▦" },
  { section: "Sell" },
  { href: "/dashboard/packages", label: "Packages & prices", icon: "▤" },
  { href: "/dashboard/codes", label: "Activation codes", icon: "#" },
  { href: "/dashboard/app-api", label: "App API", icon: "⌘" },
  { href: "/dashboard/coupons", label: "Coupons", icon: "%" },
  { href: "/dashboard/store", label: "Store page", icon: "⌂" },
  { section: "Customers" },
  { href: "/dashboard/customers/new", label: "Add customer", icon: "+", exact: true },
  { href: "/dashboard/customers/existing", label: "Load existing line", icon: "⇩", exact: true },
  { href: "/dashboard/customers", label: "Customers", icon: "☺", exact: true },
  { href: "/dashboard/subscriptions", label: "Subscriptions", icon: "↻" },
  { href: "/dashboard/expiring", label: "Expiring lines", icon: "⏳" },
  { href: "/dashboard/orders", label: "Orders & activations", icon: "✓" },
  { href: "/dashboard/transactions", label: "Transactions", icon: "€" },
  { section: "Integrations" },
  { href: "/dashboard/panels", label: "XUI One panels", icon: "⚙" },
  { href: "/dashboard/bouquets", label: "Bouquets", icon: "❖" },
  { href: "/dashboard/payments", label: "Payment gateways", icon: "▭" },
  { href: "/dashboard/maxplayer", label: "MaxPlayer", icon: "▶" },
  { href: "/dashboard/vod", label: "VOD monitoring", icon: "◫" },
  { section: "Account" },
  { href: "/dashboard/notifications", label: "Notifications", icon: "🔔" },
  { href: "/dashboard/telegram", label: "Telegram alerts", icon: "✈" },
  { href: "/dashboard/mail", label: "Email sending", icon: "✉" },
  { href: "/dashboard/emails", label: "Email texts", icon: "✎" },
  { href: "/dashboard/billing", label: "Plan & billing", icon: "★" },
  { href: "/dashboard/security", label: "Security", icon: "⚿" },
  { href: "/dashboard/logs", label: "API logs", icon: "≡" },
];

const QUICK = [
  { href: "/dashboard", label: "Home", icon: "◎", exact: true },
  { href: "/dashboard/customers", label: "Customers", icon: "☺", exact: true },
  { href: "/dashboard/customers/new", label: "Add customer", icon: "+", exact: true },
  { href: "/dashboard/codes", label: "Codes", icon: "#" },
];

function Banner({ tone, children }: { tone: "amber" | "red" | "blue"; children: React.ReactNode }) {
  const cls = tone === "red" ? "bg-rose-600 text-white" : tone === "amber" ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" : "bg-brand-50 text-brand-900 dark:bg-brand-500/10 dark:text-brand-200";
  return <div className={`flex flex-wrap items-center justify-center gap-3 px-4 py-2 text-center text-sm ${cls}`}>{children}</div>;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, reseller } = await requireReseller();
  const full = await loadResellerSaas(reseller.id);
  const billingOn = await platformBillingEnabled();
  const plansOn = await resellerPlansEnabled();
  const notices = await dashboardAnnouncements(reseller.id);
  const hidden = new Set([...(plansOn ? [] : ["/dashboard/billing"]), ...(reseller.vodMonitorEnabled ? [] : ["/dashboard/vod"])]);
  const nav = NAV.filter((i) => !("href" in i) || !hidden.has(i.href));
  const banners: React.ReactNode[] = [];
  if (!billingOn) banners.push(<Banner key="g" tone="red">The billing service is temporarily paused by the platform. New checkouts and activations are on hold.</Banner>);
  if (!reseller.billingEnabled) banners.push(<Banner key="b" tone="red">The billing module is disabled for your account. Contact the platform administrator.</Banner>);
  if (!user.emailVerifiedAt)
    banners.push(
      <Banner key="v" tone="amber">
        Confirm your email address to start selling.
        <form action={resendVerificationAction}>
          <SubmitButton className="btn-secondary btn-sm">Resend email</SubmitButton>
        </form>
      </Banner>,
    );
  if (plansOn && !saasActive(full.saas))
    banners.push(
      <Banner key="s" tone="red">
        Your platform plan is not active — your store cannot take new orders. <Link href="/dashboard/billing" className="font-semibold text-white underline">Choose a plan</Link>
      </Banner>,
    );
  else if (plansOn && full.saas?.status === "TRIALING" && full.saas.trialEndsAt)
    banners.push(
      <Banner key="t" tone="blue">
        Free trial until {full.saas.trialEndsAt.toISOString().slice(0, 10)}. <Link href="/dashboard/billing">Choose a plan</Link>
      </Banner>,
    );
  if (!env.liveOperationsAllowed) banners.push(<Banner key="l" tone="blue">Platform test mode: line creation on XUI panels and MaxPlayer is simulated until the platform owner enables live operations.</Banner>);

  return (
    <Shell brand={reseller.storeName} brandHref="/dashboard" items={nav} quick={QUICK} userEmail={user.email} banner={banners}>
      {notices.length > 0 && (
        <div className="mb-5 space-y-3">
          {notices.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
              action={
                a.dismissible ? (
                  <form action={dismissAnnouncementAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <SubmitButton className="btn-ghost btn-sm whitespace-nowrap">Got it ✕</SubmitButton>
                  </form>
                ) : undefined
              }
            />
          ))}
        </div>
      )}
      {children}
    </Shell>
  );
}
