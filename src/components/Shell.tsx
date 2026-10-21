import Link from "next/link";
import { NavLink, SubmitButton, ThemeToggle } from "./client";
import { MobileNav } from "./MobileNav";
import { BrandMark } from "./BrandMark";
import { env } from "@/lib/env";
import { logoutAction } from "@/app/(auth)/actions";

export type NavItem = { href: string; label: string; icon: string; exact?: boolean } | { section: string };

function Nav({ items }: { items: NavItem[] }) {
  return (
    <nav className="space-y-0.5">
      {items.map((it, i) =>
        "section" in it ? (
          <div key={i} className="px-3 pb-1 pt-5 text-xs font-semibold text-slate-500">
            {it.section}
          </div>
        ) : (
          <NavLink key={it.href} href={it.href} exact={it.exact}>
            <span aria-hidden className="w-4 text-center">{it.icon}</span>
            {it.label}
          </NavLink>
        ),
      )}
    </nav>
  );
}

export function Shell({ brand, brandHref, items, quick, userEmail, banner, children }: { brand: string; brandHref: string; items: NavItem[]; quick: Array<Extract<NavItem, { href: string }>>; userEmail: string; banner?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white px-3 py-5 dark:border-slate-800 dark:bg-black lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto">
        <Link href={brandHref} className="mb-5 flex items-center gap-2.5 px-3 no-underline hover:no-underline">
          <BrandMark size={34} />
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold leading-tight text-slate-950 dark:text-white" style={{ fontStretch: "125%" }}>{env.platformName}</span>
            <span className="block truncate text-xs font-medium text-slate-500">{brand}</span>
          </span>
        </Link>
        <Nav items={items} />
      </aside>
      <div className="min-w-0 flex-1">
        <div className="signal-bar sticky top-0 z-20" />
        <header className="sticky top-[3px] z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-black sm:px-6 lg:bg-white/90 lg:backdrop-blur lg:dark:bg-black/85">
          <Link href={brandHref} className="flex min-w-0 items-center gap-2 font-extrabold text-slate-950 no-underline hover:no-underline dark:text-white lg:hidden" style={{ fontStretch: "125%" }}>
            <BrandMark size={28} />
            <span className="truncate">{env.platformName}</span>
          </Link>
          <span className="hidden text-sm font-semibold text-slate-500 lg:block">{brand}</span>
          <div className="hidden items-center gap-2 lg:flex">
            <span className="muted">{userEmail}</span>
            <ThemeToggle />
            <form action={logoutAction}>
              <SubmitButton className="btn-ghost btn-sm">Sign out</SubmitButton>
            </form>
          </div>
        </header>
        {banner}
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 sm:pt-8 lg:pb-10">{children}</main>
        <MobileNav items={items} quick={quick} userEmail={userEmail} logout={logoutAction} />
      </div>
    </div>
  );
}
