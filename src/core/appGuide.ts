import { deviceLabel, deviceNote, t, unsupportedNote as codeUnsupportedNote } from "./i18n/codeFlow";
import { escapeHtml } from "./template";

/** Devices the customer can install the player app on. Hisense (VIDAA) is listed as not supported. */
export const PLATFORMS = [
  { key: "android", label: "Android phone & tablet" },
  { key: "ios", label: "iPhone & iPad" },
  { key: "androidtv", label: "Android TV / Google TV (Sony, Philips, TCL, Xiaomi…)" },
  { key: "firetv", label: "Amazon Fire TV / Fire TV Stick" },
  { key: "samsung", label: "Samsung Smart TV (Tizen)" },
  { key: "lg", label: "LG Smart TV (webOS)" },
  { key: "appletv", label: "Apple TV" },
  { key: "pc", label: "Windows / Mac / web browser" },
] as const;
export type PlatformKey = (typeof PLATFORMS)[number]["key"];

export interface PlatformEntry {
  enabled: boolean;
  /** Download link (store page). Optional — without it the note is shown. */
  url: string;
  /** Short instruction, e.g. "Search for MaxPlayer in the LG Content Store". */
  note: string;
}

export interface AppGuide {
  enabled: boolean;
  appName: string;
  platforms: Record<PlatformKey, PlatformEntry>;
  /** Shown as "not supported" (default: Hisense / VIDAA). Empty = hidden. */
  unsupportedNote: string;
  extraNote: string;
  iconVersion?: number;
  // Legacy fields (first version of the guide) — migrated into `platforms`.
  androidUrl?: string;
  iosUrl?: string;
  tvUrl?: string;
  webUrl?: string;
}

const DEFAULT_NOTES: Record<PlatformKey, string> = {
  android: "Google Play: search for “{app}”.",
  ios: "App Store: search for “{app}”.",
  androidtv: "Google Play on your TV: search for “{app}”.",
  firetv: "Fire TV home → Find → search for “{app}”.",
  samsung: "Samsung Apps on your TV: search for “{app}”.",
  lg: "LG Content Store on your TV: search for “{app}”.",
  appletv: "App Store on Apple TV: search for “{app}”.",
  pc: "",
};

export function defaultGuide(): AppGuide {
  const platforms = {} as Record<PlatformKey, PlatformEntry>;
  for (const p of PLATFORMS) platforms[p.key] = { enabled: p.key !== "pc", url: "", note: DEFAULT_NOTES[p.key] };
  return { enabled: true, appName: "MaxPlayer", platforms, unsupportedNote: "Not available on Hisense TVs (VIDAA).", extraNote: "" };
}

/** Fills missing platforms with defaults and moves links from the first version into the new fields. */
export function normalizeGuide(stored: Partial<AppGuide> | null | undefined): AppGuide {
  const d = defaultGuide();
  const g: AppGuide = { ...d, ...(stored ?? {}), platforms: { ...d.platforms } };
  for (const p of PLATFORMS) g.platforms[p.key] = { ...d.platforms[p.key], ...(stored?.platforms?.[p.key] ?? {}) };
  if (!stored?.platforms) {
    if (stored?.androidUrl) g.platforms.android.url = stored.androidUrl;
    if (stored?.iosUrl) g.platforms.ios.url = stored.iosUrl;
    if (stored?.tvUrl) g.platforms.androidtv.url = stored.tvUrl;
    if (stored?.webUrl) { g.platforms.pc.url = stored.webUrl; g.platforms.pc.enabled = true; }
  }
  if (stored?.unsupportedNote === undefined) g.unsupportedNote = d.unsupportedNote;
  return g;
}

export interface GuideDevice {
  key: PlatformKey;
  label: string;
  url: string | null;
  note: string;
}

/** Enabled devices with a safe http(s) link and/or an instruction. */
export function guideDevices(g: AppGuide): GuideDevice[] {
  return PLATFORMS.map((p): GuideDevice | null => {
    const e = g.platforms?.[p.key];
    if (!e?.enabled) return null;
    const url = /^https?:\/\/\S+$/.test(e.url) ? e.url : null;
    const note = (e.note ?? "").replace(/\{app\}/g, g.appName);
    if (!url && !note) return null;
    return { key: p.key, label: p.label as string, url, note };
  }).filter((x): x is GuideDevice => x !== null);
}

/** Download buttons (devices that have a link). */
export function guideLinks(g: AppGuide): Array<{ label: string; url: string }> {
  return guideDevices(g).filter((d) => d.url).map((d) => ({ label: d.label, url: d.url! }));
}

export function guideSteps(g: AppGuide): string[] {
  return [
    `Install the ${g.appName} app on your phone, tablet or TV (see the list below).`,
    `Open ${g.appName} and sign in with your username and password.`,
    "Your channels load automatically — enjoy!",
  ];
}

/** "BHS / English" — or just one when both are the same (brand names). */
function both(bhs: string, en: string): string {
  return !bhs || bhs === en ? en : `${bhs} / ${en}`;
}

/**
 * Plain-text and HTML blocks appended to the activation email. Bilingual like the email itself:
 * every line in BHS with the English text right below / next to it.
 */
export function guideEmailBlocks(g: AppGuide, creds: { username: string; password: string }, icon: string | null): { text: string; html: string } {
  const app = g.appName;
  const devices = guideDevices(g).map((d) => {
    const en = d.note;
    const bhs = deviceNote("bhs", d.key, g.platforms[d.key].note, DEFAULT_NOTES[d.key], app);
    return { ...d, labelBhs: deviceLabel("bhs", d.key, d.label), noteBhs: bhs === en ? "" : bhs };
  });
  const stepsEn = guideSteps(g);
  const stepsBhs = [t("bhs", "step1", { app }), t("bhs", "step2", { app }), t("bhs", "step3")];
  const unsupportedBhs = g.unsupportedNote ? codeUnsupportedNote("bhs", g.unsupportedNote) : "";
  const credLines = [`   Username: ${creds.username}`, `   Lozinka / Password: ${creds.password}`];
  const text = [
    `KAKO GLEDATI / HOW TO WATCH — ${app}`,
    ...stepsBhs.flatMap((s, i) => [`${i + 1}. ${s}`, `   ${stepsEn[i]}`, ...(i === 1 ? credLines : [])]),
    "",
    "Dostupno na / Available on:",
    ...devices.map((d) => `- ${both(d.labelBhs, d.label)}: ${[d.url, d.noteBhs, d.note].filter(Boolean).join(" — ")}`),
    g.unsupportedNote ? `Nije podržano / Not supported: ${both(unsupportedBhs, g.unsupportedNote)}` : "",
    g.extraNote,
  ].filter((l) => l !== undefined && l !== null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const e = escapeHtml;
  const gray = (s: string) => `<br><span style="color:#6b7280;font-size:13px">${e(s)}</span>`;
  const rows = devices
    .map(
      (d) =>
        `<tr><td style="padding:6px 0;border-top:1px solid #f0f0f0;font-size:14px"><b>${e(both(d.labelBhs, d.label))}</b>${d.noteBhs ? gray(d.noteBhs) : ""}${d.note ? gray(d.note) : ""}</td><td align="right" style="padding:6px 0;border-top:1px solid #f0f0f0">${d.url ? `<a href="${e(d.url)}" style="display:inline-block;padding:7px 12px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;white-space:nowrap">Preuzmi / Download</a>` : ""}</td></tr>`,
    )
    .join("");
  const credHtml = `<br><span style="color:#6b7280">Username:</span> <b style="font-family:monospace">${e(creds.username)}</b><br><span style="color:#6b7280">Lozinka / Password:</span> <b style="font-family:monospace">${e(creds.password)}</b>`;
  const html = `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid #e5e7eb;border-radius:12px"><tr><td style="padding:18px">
<table cellpadding="0" cellspacing="0"><tr>${icon ? `<td style="padding-right:12px"><img src="${e(icon)}" width="56" height="56" alt="${e(app)}" style="display:block;border-radius:12px"></td>` : ""}<td style="font-size:17px;font-weight:600">Gledajte uz ${e(app)}<br><span style="font-size:13px;font-weight:400;color:#6b7280">Watch with ${e(app)}</span></td></tr></table>
<ol style="padding-left:20px;margin:14px 0">${stepsBhs.map((s, i) => `<li style="margin:6px 0">${e(s)}${gray(stepsEn[i])}${i === 1 ? credHtml : ""}</li>`).join("")}</ol>
${devices.length ? `<div style="font-weight:600;margin:12px 0 4px">Dostupno na / Available on</div><table width="100%" cellpadding="0" cellspacing="0">${rows}</table>` : ""}
${g.unsupportedNote ? `<p style="margin:12px 0 0;color:#b91c1c;font-size:14px">✕ ${e(both(unsupportedBhs, g.unsupportedNote))}</p>` : ""}
${g.extraNote ? `<p style="margin:12px 0 0;color:#4b5563;font-size:14px">${e(g.extraNote)}</p>` : ""}
</td></tr></table>`;
  return { text, html };
}
