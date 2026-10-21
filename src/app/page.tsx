import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/client";
import { Money } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resellerPlansEnabled } from "@/lib/settings";

export const dynamic = "force-dynamic";

const FEATURES = [
  ["Connect your XUI One panel", "Paste your reseller API URL and key, test the connection and sync bouquets in one click."],
  ["Your prices, your packages", "Unlimited packages in any currency — EUR, USD, BAM, AED and more. Promotions and coupons included."],
  ["Get paid directly", "Stripe, PayPal, Mollie and crypto via NOWPayments. Money goes straight to your own account."],
  ["Instant activation", "After a confirmed payment the line is created on your panel with the right bouquets and expiry — automatically."],
  ["MaxPlayer ready", "Optionally create a MaxPlayer.tv account for every customer with the same credentials."],
  ["Your own storefront", "Branded store page, customer portal, invoices and your own domain."],
];

export default async function Landing() {
  const plansOn = await resellerPlansEnabled().catch(() => false);
  const plans = plansOn ? await db.saasPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }] }).catch(() => []) : [];
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="flex items-center gap-2.5 text-lg font-extrabold text-slate-950 dark:text-white" style={{ fontStretch: "125%" }}><BrandMark size={30} />{env.platformName}</span>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className="btn-ghost">Sign in</Link>
          <Link href="/register" className="btn-primary">{plansOn ? "Start free trial" : "Become a reseller"}</Link>
        </nav>
      </header>
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-24">
        <h1 className="text-4xl font-extrabold sm:text-5xl">{env.platformTagline}</h1>
        <p className="muted mx-auto mt-5 max-w-2xl text-lg">Sell subscriptions with your own prices, take payments into your own account or sell activation codes anywhere — lines are activated automatically.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">{plansOn ? "Create your store" : "Request a reseller account"}</Link>
          {plansOn ? <a href="#pricing" className="btn-secondary px-6 py-3 text-base">See pricing</a> : <Link href="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>}
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-5 px-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="card card-pad">
            <h3>{t}</h3>
            <p className="muted mt-2">{d}</p>
          </div>
        ))}
      </section>
      {plansOn && plans.length > 0 && <section id="pricing" className="mx-auto max-w-5xl px-4 pb-24">
        <h2 className="mb-8 text-center text-2xl">Simple pricing</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className="card card-pad flex flex-col">
              <h3>{p.name}</h3>
              <div className="my-3 text-3xl font-bold"><Money amount={p.priceCents} currency={p.currency} /><span className="muted text-sm font-normal"> / {p.interval === "YEAR" ? "year" : "month"}</span></div>
              <ul className="mb-6 flex-1 space-y-1.5 text-sm">
                <li>✓ {p.maxPackages} packages</li>
                <li>✓ {p.maxPanels} panel{p.maxPanels > 1 ? "s" : ""}</li>
                <li>✓ {p.maxActiveCustomers} active customers</li>
                <li>{p.allowMaxPlayer ? "✓" : "✗"} MaxPlayer</li>
                <li>{p.allowCustomDomain ? "✓" : "✗"} Custom domain</li>
              </ul>
              <Link href="/register" className="btn-primary">Start {env.trialDays}-day trial</Link>
            </div>
          ))}
        </div>
      </section>}
      {!plansOn && (
        <section className="mx-auto max-w-3xl px-4 pb-24 text-center">
          <div className="card card-pad">
            <h2 className="text-xl">How to join</h2>
            <p className="muted mt-2">Send a request for a reseller account. Our team reviews every request and you get an email as soon as your account is approved.</p>
            <Link href="/register" className="btn-primary mt-5 inline-flex">Submit a request</Link>
          </div>
        </section>
      )}
      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500 dark:border-slate-800">© {new Date().getFullYear()} {env.platformName}</footer>
    </div>
  );
}
