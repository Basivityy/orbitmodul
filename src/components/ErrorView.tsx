"use client";

import { useEffect } from "react";

/**
 * Shown instead of a blank page when a page fails to load (server error, lost connection while
 * a page refreshes itself…). "Try again" re-renders the page; the error id helps find the log line.
 */
export function ErrorView({ error, reset, home = "/" }: { error: Error & { digest?: string }; reset: () => void; home?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <div className="mx-auto my-10 max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <div className="text-3xl" aria-hidden>⚠</div>
      <h1 className="mt-2 text-lg font-bold">{offline ? "No internet connection" : "This page could not be loaded"}</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        {offline ? "Check the connection and try again." : "Something went wrong while loading. Try again — if it keeps happening, send the error id below to support."}
      </p>
      {error?.digest && <p className="mt-3 font-mono text-xs text-slate-500">Error id: {error.digest}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => reset()}>Try again</button>
        <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Reload page</button>
        <a className="btn-ghost" href={home}>Go to start</a>
      </div>
    </div>
  );
}
