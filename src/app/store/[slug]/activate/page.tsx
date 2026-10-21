import Link from "next/link";
import { cookies } from "next/headers";
import { SubmitButton } from "@/components/client";
import { LangSwitch } from "@/components/LangSwitch";
import { Flash } from "@/components/ui";
import { ACTIVATION_DEVICES, deviceLabel, findActivationDevice, pickLang, t } from "@/core/i18n/codeFlow";
import { resolveStore } from "@/lib/storefront";
import { redeemCodeAction } from "../actions";

export const metadata = { title: "Activate" };
export const dynamic = "force-dynamic";

/**
 * Universal activation link: the reseller sends paying customers here (with or without ?code=). BHS by default.
 * Step 1: the customer picks the device they watch on (Hisense/VIDAA → contact support, no self-activation).
 * Step 2: new line or extension.
 */
export default async function ActivatePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { base, reseller } = await resolveStore(slug);
  const lang = pickLang(sp.lang, (await cookies()).get("lang")?.value);
  const code = (sp.code ?? "").slice(0, 40);
  const extend = sp.mode === "extend";
  const device = findActivationDevice(sp.device);
  const link = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(code ? { code } : {}), ...(extend ? { mode: "extend" } : {}), lang, ...extra });
    return `${base}/activate?${q.toString()}`;
  };

  const header = (
    <>
      <div className="mb-6"><LangSwitch current={lang} label={t(lang, "language")} /></div>
      <div className="mb-8 text-center">
        <h1>{t(lang, "title")}</h1>
        <p className="muted mt-2">{device ? t(lang, "subtitle") : t(lang, "deviceSub")}</p>
      </div>
      <Flash sp={sp} />
    </>
  );

  // ── Step 1: device ──────────────────────────────────────────────────────────
  if (!device) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <h2 className="mb-4 text-center text-lg">{t(lang, "deviceQ")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {ACTIVATION_DEVICES.map((d) => (
            <Link key={d.key} href={link({ device: d.key })} className="card card-pad flex items-center gap-3 no-underline transition hover:ring-2 hover:ring-[color:var(--brand)] hover:no-underline">
              <span aria-hidden className="text-2xl">{d.icon}</span>
              <span className="font-medium text-slate-900 dark:text-white">{deviceLabel(lang, d.key, d.en)}</span>
            </Link>
          ))}
        </div>
        <p className="hint mt-6 text-center">{t(lang, "noCode")} <Link href={`${base}#packages`}>{t(lang, "buy")}</Link></p>
      </div>
    );
  }

  const chosen = (
    <p className="mb-6 text-center text-sm">
      {t(lang, "device")}: <b>{device.icon} {deviceLabel(lang, device.key, device.en)}</b> · <Link href={link({})}>{t(lang, "changeDevice")}</Link>
    </p>
  );

  // ── Hisense (VIDAA): no self-activation, contact support ───────────────────
  if (device.blocked) {
    const contacts = [
      reseller.contactWhatsapp && { label: `WhatsApp ${reseller.contactWhatsapp}`, href: `https://wa.me/${reseller.contactWhatsapp.replace(/\D/g, "")}${code ? `?text=${encodeURIComponent(`Hisense TV — ${code}`)}` : ""}` },
      reseller.contactTelegram && { label: `Telegram ${reseller.contactTelegram}`, href: `https://t.me/${reseller.contactTelegram.replace(/^@/, "")}` },
      reseller.contactEmail && { label: reseller.contactEmail, href: `mailto:${reseller.contactEmail}?subject=${encodeURIComponent(`Hisense TV${code ? ` — ${code}` : ""}`)}` },
      reseller.contactPhone && { label: reseller.contactPhone, href: `tel:${reseller.contactPhone.replace(/[^\d+]/g, "")}` },
    ].filter((c): c is { label: string; href: string } => !!c);
    return (
      <div className="mx-auto max-w-xl">
        {header}
        {chosen}
        <div className="card card-pad text-center">
          <div aria-hidden className="mb-3 text-4xl">📺</div>
          <h2 className="text-lg">{t(lang, "blockedTitle")}</h2>
          <p className="muted mt-2">{t(lang, "blockedText")}</p>
          {code && <p className="mt-4 font-mono text-lg tracking-wider">{code}</p>}
          <div className="mt-6 flex flex-col gap-2">
            {contacts.length ? (
              contacts.map((c) => (
                <a key={c.href} href={c.href} target="_blank" rel="noreferrer" className="btn w-full text-white no-underline hover:no-underline" style={{ background: "var(--brand)" }}>
                  {t(lang, "contactSupport")}: {c.label}
                </a>
              ))
            ) : (
              <p className="text-sm">{t(lang, "noContact")}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: new line or extension ───────────────────────────────────────────
  const codeField = (
    <div>
      <label className="label">{t(lang, "code")}</label>
      <input className="input font-mono uppercase tracking-wider" name="code" required defaultValue={code} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} maxLength={40} />
    </div>
  );
  const hidden = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="device" value={device.key} />
    </>
  );
  return (
    <div className="mx-auto max-w-3xl">
      {header}
      {chosen}
      <div className="grid gap-6 md:grid-cols-2">
        <form action={redeemCodeAction} className={`card card-pad space-y-4 ${!extend ? "ring-2 ring-[color:var(--brand)]" : ""}`}>
          {hidden}
          <input type="hidden" name="mode" value="new" />
          <h2 className="text-lg">{t(lang, "newLine")}</h2>
          <p className="muted text-sm">{t(lang, "newLineSub")}</p>
          {codeField}
          <div>
            <label className="label" htmlFor="lineUsername">{t(lang, "chooseUsername")}</label>
            <input className="input font-mono" id="lineUsername" name="lineUsername" required minLength={8} maxLength={30} pattern="(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9]{8,30}" title={t(lang, "usernameRule")} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="marko2026" />
            <p className="hint">{t(lang, "usernameRule")}. {t(lang, "usernameHint")}</p>
          </div>
          <div>
            <label className="label" htmlFor="email">{t(lang, "email")}</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
            <p className="hint">{t(lang, "emailHint")}</p>
          </div>
          <SubmitButton className="btn w-full text-white" style={{ background: "var(--brand)" }}>{t(lang, "create")}</SubmitButton>
        </form>

        <form action={redeemCodeAction} className={`card card-pad space-y-4 ${extend ? "ring-2 ring-[color:var(--brand)]" : ""}`}>
          {hidden}
          <input type="hidden" name="mode" value="extend" />
          <h2 className="text-lg">{t(lang, "extend")}</h2>
          <p className="muted text-sm">{t(lang, "extendSub")}</p>
          {codeField}
          <div>
            <label className="label" htmlFor="account">{t(lang, "account")}</label>
            <input className="input" id="account" name="account" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={t(lang, "accountPh")} maxLength={254} />
          </div>
          <SubmitButton className="btn-secondary w-full">{t(lang, "extend")}</SubmitButton>
        </form>
      </div>
      <p className="hint mt-6 text-center">{t(lang, "noCode")} <Link href={`${base}#packages`}>{t(lang, "buy")}</Link></p>
    </div>
  );
}
