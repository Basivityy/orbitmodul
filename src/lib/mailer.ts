import nodemailer from "nodemailer";
import { getDefaultTemplate } from "@/core/emailTemplates";
import { emailFooter, emailSenderName, renderEmail, wrapEmailHtml } from "@/core/emailLayout";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { maskSecrets } from "@/core/mailRules";
import { decrypt } from "@/core/crypto";
import { assertPublicUrl } from "@/core/net";
import { escapeHtml, textToHtml } from "@/core/template";
import { db } from "./db";
import { env } from "./env";
import { getSetting } from "./settings";

/** Platform mailbox set in Admin → Global settings (password encrypted). Overrides SMTP_* from .env. */
export const SETTING_PLATFORM_SMTP = "platform_smtp";
export interface PlatformSmtpSetting {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  passEnc: string;
  fromEmail: string;
  fromName: string;
}

export async function getPlatformSmtpSetting(): Promise<PlatformSmtpSetting | null> {
  const s = await getSetting<PlatformSmtpSetting | null>(SETTING_PLATFORM_SMTP, null);
  return s?.host ? s : null;
}

/** Where platform emails go out from: "panel" (admin settings), "env" (.env) or null (not set up). */
export async function platformSmtpSource(): Promise<{ source: "panel" | "env" | null; host: string; from: string }> {
  const s = await getPlatformSmtpSetting();
  if (s) return { source: "panel", host: s.host, from: s.fromEmail };
  if (env.smtp.host) return { source: "env", host: env.smtp.host, from: env.smtp.from };
  return { source: null, host: "", from: "" };
}

let transport: { key: string; t: nodemailer.Transporter; from: string } | null = null;

async function getTransport(): Promise<{ t: nodemailer.Transporter; from: string } | null> {
  const s = await getPlatformSmtpSetting();
  let cfg: { key: string; host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  if (s) {
    cfg = { key: JSON.stringify(s), host: s.host, port: s.port, secure: s.secure, user: s.user, pass: s.passEnc ? decrypt(s.passEnc) : "", from: `"${(s.fromName || env.platformName).replace(/"/g, "")}" <${s.fromEmail}>` };
  } else if (env.smtp.host) {
    const e = env.smtp;
    cfg = { key: "env", host: e.host, port: e.port, secure: e.secure, user: e.user, pass: e.pass, from: e.from };
  } else {
    return null;
  }
  if (!transport || transport.key !== cfg.key) {
    transport = {
      key: cfg.key,
      from: cfg.from,
      t: nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 }),
    };
  }
  return transport;
}

export async function resolveTemplate(resellerId: string | null, key: string): Promise<{ subject: string; body: string }> {
  const def = getDefaultTemplate(key);
  if (resellerId) {
    const own = await db.emailTemplate.findFirst({ where: { resellerId, key } });
    if (own) return own;
  }
  const platform = await db.emailTemplate.findFirst({ where: { resellerId: null, key } });
  return platform ?? { subject: def.subject, body: def.body };
}

const wrapHtml = wrapEmailHtml;

type Sender = { t: nodemailer.Transporter; from: string; fromEmail: string; via: "reseller" | "platform" };
const resellerTransports = new Map<string, { key: string; t: nodemailer.Transporter }>();

/** The reseller's own mailbox when configured and enabled. */
async function resellerSender(resellerId: string | null, senderName?: string | null): Promise<Sender | null> {
  if (!resellerId) return null;
  const m = await db.resellerMail.findUnique({ where: { resellerId } });
  if (!m?.enabled) return null;
  const key = `${m.id}:${m.updatedAt.getTime()}`;
  let cached = resellerTransports.get(resellerId);
  if (!cached || cached.key !== key) {
    await assertPublicUrl(`smtp://${m.host}:${m.port}`);
    cached = { key, t: nodemailer.createTransport({ host: m.host, port: m.port, secure: m.secure, auth: { user: m.username, pass: decrypt(m.passEnc) }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 }) };
    resellerTransports.set(resellerId, cached);
  }
  const name = (senderName || m.fromName || "").replace(/"/g, "").trim() || m.fromEmail;
  return { t: cached.t, from: `"${name}" <${m.fromEmail}>`, fromEmail: m.fromEmail, via: "reseller" };
}

async function platformSender(storeName: string | null): Promise<Sender | null> {
  const p = await getTransport();
  if (!p) return null;
  const addr = p.from.match(/<(.+)>/)?.[1] ?? p.from;
  return { t: p.t, from: storeName ? `"${storeName.replace(/"/g, "")}" <${addr}>` : p.from, fromEmail: addr, via: "platform" };
}

/** Sends one message through a reseller's own SMTP settings (used by "Send test email"). */
export async function sendTestThroughResellerMail(resellerId: string, to: string): Promise<void> {
  const r = await db.reseller.findUnique({ where: { id: resellerId }, select: { emailFromName: true, storeName: true } });
  const s = await resellerSender(resellerId, r ? emailSenderName(r) : null);
  if (!s) throw new Error("Save and enable your email settings first.");
  await s.t.sendMail({ from: s.from, to, subject: "Test email", text: "If you can read this, your email settings work. Your customers will receive their emails from this address." });
}

export interface SendResult {
  status: "SENT" | "LOGGED" | "FAILED" | "SKIPPED";
  via?: string;
  fromEmail?: string;
  error?: string;
}

/**
 * Renders and sends an email: through the reseller's own mailbox when they set one up, otherwise
 * through the platform SMTP; without any SMTP the message is only logged. Every email is recorded in
 * EmailLog with subject and text (line passwords masked) so the reseller can see what was sent.
 * `override` sends a draft text instead of the saved template (the editor's "Send test email").
 */
export async function sendTemplatedEmail(job: {
  resellerId: string | null;
  template: string;
  to: string;
  vars: Record<string, string>;
  extra?: { text: string; html: string };
  override?: { subject: string; body: string };
  logAs?: string;
}): Promise<SendResult> {
  if (isPlaceholderEmail(job.to)) return { status: "SKIPPED" }; // line imported from the panel, no real email yet
  const tpl = job.override ?? (await resolveTemplate(job.resellerId, job.template));
  const reseller = job.resellerId ? await db.reseller.findUnique({ where: { id: job.resellerId } }) : null;
  // The reseller's sender name is what customers see everywhere in the email (From, header, signature).
  const senderName = reseller ? emailSenderName(reseller) : null;
  const vars = { platformName: env.platformName, storeName: senderName ?? env.platformName, ...job.vars };
  const { subject, text, html } = renderEmail({
    key: job.template,
    subject: tpl.subject,
    body: tpl.body,
    vars,
    extra: job.extra,
    title: senderName ?? env.platformName,
    brandColor: reseller?.primaryColor ?? "#ffd400",
    footer: reseller ? emailFooter(reseller) : env.platformName,
  });
  const stored = { subject: subject.slice(0, 300), body: maskSecrets(text, [job.vars.password]).slice(0, 20_000) };
  const log = async (data: { status: SendResult["status"]; error?: string; via: string; fromEmail?: string }): Promise<SendResult> => {
    await db.emailLog.create({ data: { resellerId: job.resellerId, to: job.to, template: job.logAs ?? job.template, ...stored, ...data, error: data.error?.slice(0, 500) } });
    return data;
  };

  let own: Sender | null = null;
  let ownError: string | undefined;
  try {
    own = await resellerSender(job.resellerId, senderName);
  } catch (e) {
    ownError = `Your email settings: ${(e as Error).message}`;
  }
  const replyTo = reseller?.contactEmail ?? undefined;
  if (own) {
    try {
      await own.t.sendMail({ from: own.from, to: job.to, subject, text, html, replyTo });
      return await log({ status: "SENT", via: "reseller", fromEmail: own.fromEmail });
    } catch (e) {
      ownError = `Your email settings: ${(e as Error).message}`;
    }
  }
  // Platform mailbox (also the fallback when the reseller's own SMTP failed).
  const platform = await platformSender(senderName);
  if (!platform) {
    console.log(`[mail:dev] to=${job.to} subject="${subject}"\n${stored.body}\n`);
    const r = await log({ status: ownError ? "FAILED" : "LOGGED", via: "log", error: ownError });
    if (ownError) throw new Error(ownError);
    return r;
  }
  try {
    await platform.t.sendMail({ from: platform.from, to: job.to, subject, text, html, replyTo });
    return await log({ status: "SENT", via: ownError ? "platform (fallback)" : "platform", fromEmail: platform.fromEmail, error: ownError });
  } catch (e) {
    await log({ status: "FAILED", via: "platform", fromEmail: platform.fromEmail, error: [ownError, String((e as Error).message)].filter(Boolean).join(" · ") });
    throw e;
  }
}

/** Plain email without template (used for the SMTP test). Throws when sending fails. */
export async function sendPlainEmail(to: string, subject: string, text: string): Promise<void> {
  const p = await getTransport();
  if (!p) throw new Error("SMTP is not configured");
  await p.t.sendMail({ from: p.from, to, subject, text, html: wrapHtml(env.platformName, textToHtml(escapeHtml(text)), "#ffd400", env.platformName) });
}
