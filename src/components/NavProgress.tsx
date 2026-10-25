"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Visible feedback for every page change: a moving bar at the top and a "Loading…" pill, from the
 * moment a link is clicked or a form is sent until the new page is there. Without it a slow
 * server answer looks like a frozen site, especially on phones.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const timers = useRef<number[]>([]);

  const stop = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setBusy(false);
    setSlow(false);
  };

  const start = () => {
    stop();
    // Tiny delay: instant pages (cache, prefetch) never flash the bar.
    timers.current.push(window.setTimeout(() => setBusy(true), 120));
    timers.current.push(window.setTimeout(() => setSlow(true), 6000));
    // Safety: never stays on forever (e.g. a download link that does not change the page).
    timers.current.push(window.setTimeout(stop, 45000));
  };

  // New page is shown → done.
  useEffect(stop, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (/\/(export|template)(\/|$|\?)|\.(csv|zip|png|pdf)$/i.test(url.pathname)) return; // file downloads
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page / #anchor
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      // After confirm() was cancelled the event is already prevented.
      window.setTimeout(() => {
        if (!e.defaultPrevented) start();
      }, 0);
    };
    const onPop = () => start();
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  if (!busy) return null;
  return (
    <>
      <div className="nav-progress" role="progressbar" aria-label="Loading" />
      <div className="fixed top-[calc(0.75rem+env(safe-area-inset-top))] left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-semibold text-white shadow-lg ring-1 ring-brand-500/60" role="status" aria-live="polite">
        <span className="spinner" aria-hidden />
        {slow ? "Still loading… please wait" : "Loading…"}
      </div>
    </>
  );
}
