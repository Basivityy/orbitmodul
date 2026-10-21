/** One admin announcement as resellers see it (dashboard banner, history page and the admin preview). */
const STYLE: Record<string, { box: string; icon: string }> = {
  INFO: { box: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100", icon: "i" },
  SUCCESS: { box: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100", icon: "✓" },
  WARNING: { box: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100", icon: "!" },
  URGENT: { box: "border-rose-400 bg-rose-50 text-rose-950 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-100", icon: "!!" },
};

/** Plain text with line breaks; http(s) links become clickable (everything else stays escaped text). */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="break-all font-medium underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function AnnouncementCard({ a, footer, action }: { a: { title: string; body: string; tone: string; createdAt?: Date }; footer?: React.ReactNode; action?: React.ReactNode }) {
  const s = STYLE[a.tone] ?? STYLE.INFO;
  return (
    <div role={a.tone === "URGENT" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${s.box}`}>
      <span aria-hidden className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-white/70 px-1.5 text-xs font-black dark:bg-black/30">{s.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{a.title}</div>
        <div className="mt-0.5 whitespace-pre-line break-words text-sm"><Linked text={a.body} /></div>
        {footer && <div className="mt-1 text-xs opacity-70">{footer}</div>}
      </div>
      {action}
    </div>
  );
}
