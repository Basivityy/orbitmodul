import Link from "next/link";

export type HealthTone = "ok" | "warn" | "bad" | "off";

/** One line of the "System status" strip on the overview. */
export function HealthItem({ tone, title, detail, href }: { tone: HealthTone; title: string; detail: string; href: string }) {
  const dot = tone === "ok" ? "bg-emerald-400" : tone === "warn" ? "bg-brand-500" : tone === "bad" ? "bg-rose-500" : "bg-slate-500";
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3.5 no-underline hover:border-slate-950 hover:no-underline dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${tone === "bad" ? "animate-pulse" : ""}`} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-950 dark:text-white">{title}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{detail}</span>
      </span>
    </Link>
  );
}
