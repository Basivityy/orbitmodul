import Link from "next/link";
import { ThemeToggle } from "@/components/client";
import { resolveStore } from "@/lib/storefront";
import { inkFor } from "@/core/color";
import { storeTestPaymentsEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { reseller } = await resolveStore(slug);
  return { title: { default: reseller.storeName, template: `%s · ${reseller.storeName}` }, description: reseller.description ?? undefined, robots: { index: true, follow: true } };
}

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { reseller, base } = await resolveStore(slug);
  const testPayments = await storeTestPaymentsEnabled();
  const style = { "--brand": reseller.primaryColor, "--accent": reseller.accentColor, "--brand-ink": inkFor(reseller.primaryColor) } as React.CSSProperties;
  return (
    <div style={style} className="flex min-h-screen flex-col">
      {testPayments && <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">TEST MODE — payments are simulated, no real money is charged</div>}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-black">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:py-4">
          <Link href={base || "/"} className="flex min-w-0 items-center gap-2.5 text-base font-extrabold text-slate-900 no-underline hover:no-underline dark:text-white sm:text-lg" style={{ fontStretch: "112%" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {reseller.logoUrl && <img src={reseller.logoUrl} alt="" className="h-8 w-auto shrink-0 rounded sm:h-9" />}
            <span className="truncate">{reseller.storeName}</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Link href={`${base}/renew`} className="btn-ghost btn-sm">Extend</Link>
            <Link href={`${base}/portal`} className="btn-ghost btn-sm">Account</Link>
            <span className="hidden sm:inline-flex"><ThemeToggle /></span>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-12">{children}</main>
      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-5 gap-y-2 px-4">
          {reseller.contactEmail && <a href={`mailto:${reseller.contactEmail}`}>{reseller.contactEmail}</a>}
          {reseller.contactTelegram && <span>Telegram: {reseller.contactTelegram}</span>}
          {reseller.contactWhatsapp && <span>WhatsApp: {reseller.contactWhatsapp}</span>}
          {reseller.termsText && <Link href={`${base}/terms`}>Terms</Link>}
          {reseller.refundPolicy && <Link href={`${base}/refund-policy`}>Refund policy</Link>}
        </div>
      </footer>
    </div>
  );
}
