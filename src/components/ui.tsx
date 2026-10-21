import Link from "next/link";
import { formatMoney } from "@/core/money";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className = "", pad = true }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800 sm:px-5 sm:py-4">
          <div>
            {title && <h2 className="text-base">{title}</h2>}
            {description && <p className="muted mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "card-pad" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "green" | "red" | "amber" }) {
  const color = tone === "green" ? "text-emerald-600 dark:text-emerald-400" : tone === "red" ? "text-rose-600 dark:text-rose-400" : tone === "amber" ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white";
  return (
    <div className="card card-pad">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-extrabold ${color}`} style={{ fontStretch: "112%" }}>{value}</div>
      {hint && <div className="muted mt-1 text-xs">{hint}</div>}
    </div>
  );
}

export function Field({ label, name, hint, children }: { label: string; name?: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Toggle({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="checkbox mt-0.5" />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="hint block">{hint}</span>}
      </span>
    </label>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.err === "string" ? sp.err : null;
  if (!ok && !err) return null;
  return (
    <div
      role={err ? "alert" : "status"}
      className={`mb-5 flex items-start gap-3 rounded-lg border-l-4 px-4 py-3 text-sm ${err ? "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100" : "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100"}`}
    >
      <span aria-hidden className="font-black">{err ? "!" : "✓"}</span>
      <span className="min-w-0 break-words">{err ?? ok}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-brand-500" aria-hidden />
      <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {children && <div className="muted mt-1">{children}</div>}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "badge-green",
  COMPLETED: "badge-green",
  CONNECTED: "badge-green",
  SUCCEEDED: "badge-green",
  PAID: "badge-blue",
  ACTIVATING: "badge-blue",
  TRIALING: "badge-blue",
  PENDING: "badge-amber",
  UNTESTED: "badge-gray",
  ON_HOLD: "badge-amber",
  PAST_DUE: "badge-amber",
  EXPIRED: "badge-gray",
  CANCELED: "badge-gray",
  NONE: "badge-gray",
  REFUNDED: "badge-gray",
  FAILED: "badge-red",
  ACTIVATION_FAILED: "badge-red",
  ERROR: "badge-red",
  SUSPENDED: "badge-red",
  APPROVED: "badge-green",
  REJECTED: "badge-red",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={STATUS_TONE[status] ?? "badge-gray"}>{label ?? status.replace(/_/g, " ").toLowerCase()}</span>;
}

export function Money({ amount, currency }: { amount: number; currency: string }) {
  return <span className="tabular-nums">{formatMoney(amount, currency)}</span>;
}

export function DateTime({ value, dateOnly }: { value: Date | null | undefined; dateOnly?: boolean }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const s = dateOnly ? value.toISOString().slice(0, 10) : value.toISOString().slice(0, 16).replace("T", " ");
  return <time dateTime={value.toISOString()} className="tabular-nums">{s}{dateOnly ? "" : " UTC"}</time>;
}

export function Pagination({ page, hasMore, baseHref }: { page: number; hasMore: boolean; baseHref: string }) {
  const sep = baseHref.includes("?") ? "&" : "?";
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 dark:border-slate-800">
      {page > 1 ? <Link className="btn-secondary btn-sm" href={`${baseHref}${sep}page=${page - 1}`}>← Previous</Link> : <span />}
      <span className="muted">Page {page}</span>
      {hasMore ? <Link className="btn-secondary btn-sm" href={`${baseHref}${sep}page=${page + 1}`}>Next →</Link> : <span />}
    </div>
  );
}

/** Minimal server-rendered bar chart (no JS, accessible). */
export function BarChart({ data, currency, height = 160 }: { data: Array<{ label: string; value: number }>; currency?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(data.length, 1);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Revenue chart">
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 2);
          return (
            <rect key={i} x={i * w + w * 0.15} y={height / 4 - h} width={w * 0.7} height={Math.max(h, d.value > 0 ? 0.6 : 0.2)} rx={0.6} className={d.value > 0 ? "fill-brand-500" : "fill-slate-200 dark:fill-slate-800"}>
              <title>{`${d.label}: ${currency ? formatMoney(d.value, currency) : d.value}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}
