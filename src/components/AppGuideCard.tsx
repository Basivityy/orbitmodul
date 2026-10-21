import { defaultGuide, guideDevices, guideSteps, type AppGuide } from "@/core/appGuide";
import { deviceLabel, deviceNote, t, unsupportedNote, type Lang } from "@/core/i18n/codeFlow";
import { CopyButton } from "./client";

/** "Watch with MaxPlayer" box: icon, steps with the customer's credentials, download buttons. */
export function AppGuideCard({ guide, iconUrl, username, password, lang = "en" }: { guide: AppGuide; iconUrl: string | null; username: string; password: string; lang?: Lang }) {
  const steps = lang === "en" ? guideSteps(guide) : [t(lang, "step1", { app: guide.appName }), t(lang, "step2", { app: guide.appName }), t(lang, "step3")];
  const devices = guideDevices(guide).map((d) => ({ ...d, label: deviceLabel(lang, d.key, d.label), note: deviceNote(lang, d.key, guide.platforms[d.key]?.note ?? "", defaultGuide().platforms[d.key].note, guide.appName) }));
  return (
    <div className="rounded-xl border border-slate-200 p-4 text-left dark:border-slate-700">
      <div className="flex items-center gap-3">
        {iconUrl ? <img src={iconUrl} alt={guide.appName} width={52} height={52} className="rounded-xl" /> : <div className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-slate-900 text-xl text-white">▶</div>}
        <div className="text-base font-semibold">{lang === "en" ? "Watch with" : t(lang, "watchWith")} {guide.appName}</div>
      </div>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
        {steps.map((s, i) => (
          <li key={i}>
            {s}
            {i === 1 && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2"><span className="muted w-20">{t(lang, "username")}</span><code className="select-all">{username}</code><CopyButton text={username} /></div>
                <div className="flex items-center gap-2"><span className="muted w-20">{t(lang, "password")}</span><code className="select-all">{password}</code><CopyButton text={password} /></div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {devices.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold">{t(lang, "availableOn")}</div>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {devices.map((d) => (
              <li key={d.key} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <div className="font-medium">{d.label}</div>
                  {d.note && <div className="muted text-xs">{d.note}</div>}
                </div>
                {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm shrink-0">{t(lang, "download")}</a>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {guide.unsupportedNote && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">✕ {unsupportedNote(lang, guide.unsupportedNote)}</p>}
      {guide.extraNote && <p className="muted mt-3 text-sm">{guide.extraNote}</p>}
    </div>
  );
}
