import Link from "next/link";
import { Shell, NavItem } from "@/components/Shell";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { platformBillingEnabled, resellerPlansEnabled, storeTestPaymentsEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { href: "/admin", label: "Platform overview", icon: "◎", exact: true },
  { href: "/admin/resellers", label: "Resellers", icon: "☺" },
  { href: "/admin/customers", label: "All customers & lines", icon: "☷" },
  { href: "/admin/users", label: "All accounts", icon: "⚇" },
  { href: "/admin/activations", label: "Failed activations", icon: "!" },
  { href: "/admin/transactions", label: "Transactions", icon: "€" },
  { href: "/admin/logs", label: "System errors", icon: "≡" },
  { section: "Platform" },
  { href: "/admin/plans", label: "SaaS plans", icon: "★" },
  { href: "/admin/settings", label: "Global settings", icon: "⚙" },
  { href: "/admin/bouquets", label: "Bouquet names", icon: "▦" },
  { href: "/admin/app-guide", label: "Customer app guide", icon: "▶" },
  { href: "/admin/announcements", label: "Notifications to resellers", icon: "📣" },
  { href: "/admin/emails", label: "Platform emails", icon: "✉" },
  { href: "/admin/admins", label: "Administrators", icon: "⚿" },
  { href: "/admin/audit", label: "Audit log", icon: "☰" },
  { href: "/admin/security", label: "My security", icon: "🔒" },
];

const QUICK = [
  { href: "/admin", label: "Home", icon: "◎", exact: true },
  { href: "/admin/resellers", label: "Resellers", icon: "☺" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
  { href: "/admin/activations", label: "Failures", icon: "!" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const billingOn = await platformBillingEnabled();
  const testPayments = await storeTestPaymentsEnabled();
  const plansOn = await resellerPlansEnabled();
  const pending = await db.reseller.count({ where: { approvalStatus: "PENDING" } });
  const nav = plansOn ? NAV : NAV.filter((i) => !("href" in i) || i.href !== "/admin/plans");
  const banner = [
    pending > 0 && (
      <div key="p" className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">
        {pending === 1 ? "1 new reseller is" : `${pending} new resellers are`} waiting for your approval. <Link href="/admin/resellers?approval=PENDING" className="text-amber-950 underline">Review now</Link>
      </div>
    ),
    !billingOn && <div key="b" className="bg-rose-600 px-4 py-2 text-center text-sm text-white">The billing service is globally PAUSED. Resellers cannot take orders and activations are on hold.</div>,
    testPayments && <div key="t" className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">Test mode for payments is ON — all stores take simulated payments only. Turn it off in Global settings before going live.</div>,
    !env.liveOperationsAllowed && <div key="l" className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Live panel operations are disabled (ALLOW_LIVE_PANEL_OPERATIONS=false): all line creation and MaxPlayer calls are simulated.</div>,
  ];
  return (
    <Shell brand="Admin panel" brandHref="/admin" items={nav} quick={QUICK} userEmail={`${user.email} (${user.role === "SUPER_ADMIN" ? "super admin" : "admin"})`} banner={banner}>
      {children}
    </Shell>
  );
}
