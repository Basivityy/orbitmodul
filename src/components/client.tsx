"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={`nav-link ${active ? "nav-link-active" : ""}`}>
      {children}
    </Link>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      aria-label="Toggle dark mode"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("theme", next ? "dark" : "light");
        } catch {}
      }}
    >
      {dark ? "☀︎ Light" : "☾ Dark"}
    </button>
  );
}

export function SubmitButton({ children, className = "btn-primary", name, value, confirm, formAction, style }: { children: React.ReactNode; className?: string; name?: string; value?: string; confirm?: string; formAction?: (fd: FormData) => void | Promise<void>; style?: React.CSSProperties }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={className}
      style={style}
      disabled={pending}
      formAction={formAction}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", compact = false }: { text: string; label?: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={compact ? "Copy" : undefined}
      aria-label={compact ? `Copy ${text}` : undefined}
      className={compact ? "inline-flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-slate-800 dark:hover:text-white" : "btn-secondary btn-sm"}
      onClick={async () => {
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          // Plain http:// (e.g. the server IP) has no Clipboard API — fall back to a hidden textarea.
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand("copy");
            document.body.removeChild(ta);
          } catch {}
        }
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else {
          window.prompt("Copy:", text);
        }
      }}
    >
      {done ? (compact ? "✓" : "Copied ✓") : label}
    </button>
  );
}

export function Secret({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <code className="select-all">{shown ? value : "••••••••••"}</code>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Show"}
      </button>
      {shown && <CopyButton text={value} />}
    </span>
  );
}

/** Refreshes server data periodically while `active` (e.g. order activation status). */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}

export function PrintButton() {
  return (
    <button type="button" className="btn-secondary print:hidden" onClick={() => window.print()}>
      Download / Print PDF
    </button>
  );
}
