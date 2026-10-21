"use server";

import { decrypt, encrypt } from "@/core/crypto";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/core/password";
import { generateTotpSecret, verifyTotp } from "@/core/totp";
import { act, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, issueToken, requireUser, USER_COOKIE } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueueEmail } from "@/lib/queue";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { sha256 } from "@/core/crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireReseller } from "@/lib/auth";

/** Works for resellers and admins (security page is shared). */
function backFor(role: string) {
  return role === "RESELLER" ? "/dashboard/security" : "/admin/security";
}

export async function resendVerificationAction() {
  const user = await requireUser();
  return act("/dashboard", async () => {
    if (user.emailVerifiedAt) return "Email already confirmed.";
    if (!(await rateLimit(`verify:${user.id}`, 3, 3600))) throw new UserError("Please wait before requesting another email.");
    const token = await issueToken("EMAIL_VERIFY", { userId: user.id }, 24 * 60);
    await enqueueEmail({ resellerId: null, template: "verify_email", to: user.email, vars: { name: user.name, verifyUrl: `${env.appUrl}/verify-email?token=${token}` } });
    return "Confirmation email sent.";
  });
}

export async function changePasswordAction(fd: FormData) {
  const user = await requireUser();
  return act(backFor(user.role), async () => {
    if (!(await verifyPassword(str(fd, "current", 200), user.passwordHash))) throw new UserError("Current password is incorrect.");
    const next = str(fd, "password", 200);
    const err = passwordPolicyError(next);
    if (err) throw new UserError(err);
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    // Sign out other sessions
    const current = (await cookies()).get(USER_COOKIE)?.value;
    await db.session.deleteMany({ where: { userId: user.id, NOT: current ? { tokenHash: sha256(current) } : undefined } });
    await audit({ actor: actorOf(user), action: "account.password_changed", ip: await clientIp() });
    return "Password changed. Other sessions were signed out.";
  });
}

export async function startTotpAction() {
  const user = await requireUser();
  return act(backFor(user.role), async () => {
    if (user.totpEnabled) throw new UserError("Two-factor authentication is already enabled.");
    await db.user.update({ where: { id: user.id }, data: { totpSecretEnc: encrypt(generateTotpSecret()) } });
    return "Scan the QR code and enter a code to finish.";
  });
}

export async function enableTotpAction(fd: FormData) {
  const user = await requireUser();
  return act(backFor(user.role), async () => {
    if (!user.totpSecretEnc) throw new UserError("Start the setup first.");
    if (!verifyTotp(decrypt(user.totpSecretEnc), str(fd, "code", 10))) throw new UserError("Invalid code — check the time on your phone and try again.");
    await db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await audit({ actor: actorOf(user), action: "account.2fa_enabled", ip: await clientIp() });
    return "Two-factor authentication is now enabled.";
  });
}

export async function disableTotpAction(fd: FormData) {
  const user = await requireUser();
  return act(backFor(user.role), async () => {
    if (!user.totpEnabled || !user.totpSecretEnc) return "Two-factor authentication is not enabled.";
    if (!(await verifyPassword(str(fd, "password", 200), user.passwordHash))) throw new UserError("Password is incorrect.");
    if (!verifyTotp(decrypt(user.totpSecretEnc), str(fd, "code", 10))) throw new UserError("Invalid code.");
    await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null } });
    await audit({ actor: actorOf(user), action: "account.2fa_disabled", ip: await clientIp() });
    return "Two-factor authentication disabled.";
  });
}

export async function revokeOtherSessionsAction() {
  const user = await requireUser();
  return act(backFor(user.role), async () => {
    const current = (await cookies()).get(USER_COOKIE)?.value;
    const r = await db.session.deleteMany({ where: { userId: user.id, NOT: current ? { tokenHash: sha256(current) } : undefined } });
    return `Signed out ${r.count} other session(s).`;
  });
}

/** "Got it" on an admin notification: hides it for this reseller (urgent, non-closable ones stay). */
export async function dismissAnnouncementAction(fd: FormData) {
  const { reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  const a = await db.announcement.findFirst({ where: { id, dismissible: true, OR: [{ resellerId: null }, { resellerId: reseller.id }] } });
  if (a) {
    await db.announcementDismissal.upsert({
      where: { announcementId_resellerId: { announcementId: a.id, resellerId: reseller.id } },
      create: { announcementId: a.id, resellerId: reseller.id },
      update: {},
    });
  }
  // Back to the page the reseller was on.
  let back = "/dashboard";
  try {
    const ref = new URL((await headers()).get("referer") ?? "");
    if (ref.pathname.startsWith("/dashboard")) back = ref.pathname + ref.search;
  } catch {}
  redirect(back);
}
