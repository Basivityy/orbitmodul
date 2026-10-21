/** Shown instantly while the next page loads (navigation feels immediate on phones). */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 h-7 w-48 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-24 rounded-lg bg-slate-200 dark:bg-slate-900" />
        <div className="h-24 rounded-lg bg-slate-200 dark:bg-slate-900" />
        <div className="h-24 rounded-lg bg-slate-200 dark:bg-slate-900" />
      </div>
      <div className="mt-6 h-64 rounded-lg bg-slate-200 dark:bg-slate-900" />
    </div>
  );
}
