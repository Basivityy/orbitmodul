export default function Loading() {
  return (
    <div className="mx-auto max-w-xl animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mx-auto mb-6 h-8 w-56 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-72 rounded-lg bg-slate-200 dark:bg-slate-900" />
    </div>
  );
}
