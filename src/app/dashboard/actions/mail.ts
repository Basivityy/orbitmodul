"use server";

import { encrypt } from "@/core/crypto";
import { findTemplate } from "@/core/emailTemplates";
import { isValidEmail } from "@/core/ids";
import { smtpSettingsError } from "@/core/mailRules";
import { assertPublicUrl } from "@/core/net";
import { act, bool, int, str, UserError } from "@/lib/action";
import { appIconUrl, getAppGuide, guideEmailBlocks } from "@/lib/appGuide";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { sampleEmailVars } from "@/lib/customerEmails";
import { db } from "@/lib/db";
import { sendTemplatedEmail, sendTestThroughResellerMail } from "@/lib/mailer";
import { rateLimit } from "@/lib/ratelimit";
import type { TestState } from "../emails/EmailTemplateEditor";

export async function saveMailSettingsAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/mail", async () => {
    const data = {
      host: str(fd, "host", 200).trim().toLowerCase(),
      port: int(fd, "port", { fallback: 587, min: 1, max: 65535 }),
      secure: bool(fd, "secure"),
      username: str(fd, "username", 200).trim(),
      fromEmail: str(fd, "fromEmail", 200).trim().toLowerCase(),
      fromName: str(fd, "fromName", 80).replace(/["<>\r\n]/g, "").replace(/\s+/g, " ").trim() || null,
      enabled: bool(fd, "enabled"),
    };
    const err = smtpSettingsError(data);
    if (err) throw new UserError(err);
    try {
      await assertPublicUrl(`smtp://${data.host}:${data.port}`);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    const pass = str(fd, "password", 300);
    const existing = await db.resellerMail.findUnique({ where: { resellerId: reseller.id } });
    if (!existing && !pass) throw new UserError("Enter the SMTP password (or app password / SMTP key).");
    const passEnc = pass ? encrypt(pass) : existing!.passEnc;
    await db.resellerMail.upsert({ where: { resellerId: reseller.id }, create: { resellerId: reseller.id, ...data, passEnc }, update: { ...data, passEnc, lastError: null } });
    // One sender name for all emails (also shown under Email texts → Sender name).
    await db.reseller.update({ where: { id: reseller.id }, data: { emailFromName: data.fromName } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "mail.settings_saved", meta: { host: data.host, enabled: data.enabled } });
    return data.enabled ? "Saved. Your customers' emails are now sent from your address — send a test email to check." : "Saved (not active yet — tick “Send my customers' emails through this mailbox”).";
  });
}

export async function testMailSettingsAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/mail", async () => {
    const to = (str(fd, "to", 254) || user.email).toLowerCase();
    if (!isValidEmail(to)) throw new UserError("Enter a valid email address for the test.");
    if (!(await rateLimit(`mailtest:${reseller.id}`, 15, 3600))) throw new UserError("Too many test emails. Try again in an hour.");
    try {
      await sendTestThroughResellerMail(reseller.id, to);
      await db.resellerMail.update({ where: { resellerId: reseller.id }, data: { lastTestAt: new Date(), lastError: null } });
    } catch (e) {
      const msg = (e as Error).message;
      await db.resellerMail.updateMany({ where: { resellerId: reseller.id }, data: { lastError: msg.slice(0, 500) } });
      throw new UserError(`Test failed: ${msg}`);
    }
    return `Test email sent to ${to}. Check the inbox (and spam).`;
  });
}

export async function removeMailSettingsAction() {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/mail", async () => {
    await db.resellerMail.deleteMany({ where: { resellerId: reseller.id } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "mail.settings_removed" });
    return "Removed. Emails are sent through the platform again.";
  });
}

/**
 * "Send test" in the email editor: sends the (possibly unsaved) text of one customer email with
 * example data to any address, exactly the way real customer emails go out.
 */
export async function sendTemplateTestAction(_prev: TestState, fd: FormData): Promise<TestState> {
  const { user, reseller } = await requireReseller();
  const key = str(fd, "key", 60);
  const def = findTemplate(key);
  if (!def || def.audience !== "customer") return { ok: false, message: "Unknown email." };
  const to = str(fd, "to", 254).toLowerCase();
  if (!isValidEmail(to)) return { ok: false, message: "Enter a valid email address." };
  if (!(await rateLimit(`mailtest:${reseller.id}`, 15, 3600))) return { ok: false, message: "Too many test emails. Try again in an hour." };
  const subject = str(fd, "subject", 200) || def.subject;
  const body = str(fd, "body", 10000) || def.body;
  const vars = await sampleEmailVars(reseller);
  const guide = def.credentials && vars.maxPlayerNote ? await getAppGuide() : null;
  const extra = guide?.enabled ? guideEmailBlocks(guide, { username: vars.username, password: vars.password }, appIconUrl(guide)) : undefined;
  try {
    const r = await sendTemplatedEmail({ resellerId: reseller.id, template: key, to, vars, extra, override: { subject: `[TEST] ${subject}`, body }, logAs: "test" });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "email_template.test_sent", target: key, meta: { to, status: r.status } });
    if (r.status === "SENT") {
      const from = r.via === "reseller" ? `from ${r.fromEmail}` : "through the platform mailbox";
      return { ok: true, message: `Test email sent to ${to} ${from}. Check the inbox (and the spam folder).${r.error ? ` Note: ${r.error}` : ""}` };
    }
    if (r.status === "LOGGED") return { ok: false, message: "Nothing was sent: no email server is set up. Set up your mailbox under Email sending, or ask the platform administrator to set up platform email." };
    return { ok: false, message: r.error ?? "Sending failed." };
  } catch (e) {
    return { ok: false, message: `Sending failed: ${(e as Error).message}` };
  }
}
