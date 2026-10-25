/** Shown instantly while a page loads: clear "Loading…" text plus a light skeleton. */
export function LoadingView({ variant = "panel" }: { variant?: "panel" | "store" | "plain" }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 flex items-center gap-3 text-base font-semibold">
        <span className="spinner" aria-hidden />
        Loading…
      </div>
      {variant === "panel" && (
        <div className="animate-pulse">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="h-24 rounded-lg bg-slate-200 dark:bg-slate-900" />
            <div className="h-24 rounded-lg bg-slate-200 dark:bg-slate-900" />
            <div className="h-24 rounded-lg bg-slate-200 dark:bg-slate-900" />
          </div>
          <div className="mt-6 h-64 rounded-lg bg-slate-200 dark:bg-slate-900" />
        </div>
      )}
      {variant === "store" && <div className="mx-auto h-72 max-w-xl animate-pulse rounded-lg bg-slate-200 dark:bg-slate-900" />}
    </div>
  );
}
