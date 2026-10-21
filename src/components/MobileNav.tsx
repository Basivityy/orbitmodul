"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SubmitButton, ThemeToggle } from "./client";
import type { NavItem } from "./Shell";

type Item = Extract<NavItem, { href: string }>;

function isActive(path: string, it: Item) {
  return it.exact ? path === it.href : path === it.href || path.startsWith(it.href + "/");
}

/**
 * Phone navigation: a bottom bar with the most used pages (thumb reach) and a full-screen menu
 * with everything else. Hidden from lg screens up, where the sidebar is used.
 */
export function MobileNav({ items, quick, userEmail, logout }: { items: NavItem[]; quick: Item[]; userEmail: string; logout: (fd: FormData) => void | Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  // Close the menu after navigating, lock page scroll while it is open.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-black lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {quick.map((it, i) => {
            const active = isActive(path, it);
            const primary = i === 2;
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold no-underline hover:no-underline ${active ? "text-brand-800 dark:text-brand-400" : "text-slate-500 dark:text-slate-400"}`}
                  aria-current={active ? "page" : undefined}
                >
                  {primary ? (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-xl font-black text-black">{it.icon}</span>
                  ) : (
                    <span className={`text-lg leading-none ${active ? "" : "opacity-80"}`} aria-hidden>{it.icon}</span>
                  )}
                  {!primary && <span className="truncate px-1">{it.label}</span>}
                  {primary && <span className="sr-only">{it.label}</span>}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} className="flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400" aria-expanded={open}>
              <span className="text-lg leading-none" aria-hidden>☰</span>
              Menu
            </button>
          </li>
        </ul>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-black lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="signal-bar" />
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <span className="truncate text-sm text-slate-500">{userEmail}</span>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary btn-sm">Close ✕</button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-8">
            {items.map((it, i) =>
              "section" in it ? (
                <div key={i} className="px-3 pb-1 pt-5 text-xs font-semibold text-slate-500">{it.section}</div>
              ) : (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`nav-link py-3 text-base ${isActive(path, it) ? "nav-link-active" : ""}`}
                >
                  <span aria-hidden className="w-5 text-center">{it.icon}</span>
                  {it.label}
                </Link>
              ),
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
            <ThemeToggle />
            <form action={logout}>
              <SubmitButton className="btn-secondary">Sign out</SubmitButton>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
