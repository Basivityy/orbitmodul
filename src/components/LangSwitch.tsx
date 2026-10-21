"use client";

import { usePathname, useRouter } from "next/navigation";
import { LANG_LABEL, LANGS, type Lang } from "@/core/i18n/codeFlow";

/** BHS | EN | DE — remembered in a cookie for the code pages. */
export function LangSwitch({ current, label }: { current: Lang; label: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <div className="flex items-center justify-center gap-1" role="group" aria-label={label}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === current}
          className={`btn-sm rounded-md px-3 font-semibold ${l === current ? "bg-brand-500 text-black" : "btn-ghost"}`}
          onClick={() => {
            try {
              document.cookie = `lang=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
            } catch {}
            const q = new URLSearchParams(window.location.search);
            q.set("lang", l);
            q.delete("err");
            q.delete("ok");
            router.push(`${path}?${q.toString()}`);
          }}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
