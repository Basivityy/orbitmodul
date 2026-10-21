"use server";

import { decrypt } from "@/core/crypto";
import { isValidEmail, isValidSlug, slugify } from "@/core/ids";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/core/password";
import { verifyTotp } from "@/core/totp";
import { act, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { completeTwoFactor, consumeToken, createUserSession, destroyUserSession, getCurrentUser, getPendingTwoFactorUser, issueToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueueEmail } from "@/lib/queue";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { getSetting, SETTING_REGISTRATION_OPEN } from "@/lib/settings";

const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export async function registerAction(fd: FormData) {
  return act("/register", async () => {
    if (!(await getSetting<boolean>(SETTING_REGISTRATION_OPEN, true))) throw new UserError("Registration is currently closed.");
    const ip = await clientIp();
    if (!(await rateLimit(`register:${ip}`, 5, 3600))) throw new UserError("Too many attempts. Try again later.");

    const name = str(fd, "name", 100);
    const email = str(fd, "email", 254).toLowerCase();
    const password = str(fd, "password", 200);
    const storeName = str(fd, "storeName", 80);
    const slug = (str(fd, "slug", 40) || slugify(storeName)).toLowerCase();
    if (!name || !storeName) throw new UserError("Name and store name are required.");
    if (!isValidEmail(email)) throw new UserError("Enter a valid email address.");
    const pwErr = passwordPolicyError(password);
    if (pwErr) throw new UserError(pwErr);
    if (!isValidSlug(slug)) throw new UserError("Store address may contain lowercase letters, numbers and dashes (3–40 characters).");
    if (await db.user.findUnique({ where: { email } })) throw new UserError("An account with this email already exists.");
    if (await db.reseller.findUnique({ where: { slug } })) throw new UserError("This store address is taken. Choose another one.");

    const user = await db.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        role: "RESELLER",
        // Every new reseller waits for the Super Admin's approval (Admin → Resellers).
        reseller: { create: { slug, storeName, contactEmail: email, approvalStatus: "PENDING" } },
      },
      include: { reseller: true },
    });
    const token = await issueToken("EMAIL_VERIFY", { userId: user.id }, 24 * 60);
    await enqueueEmail({ resellerId: null, template: "reseller_welcome", to: email, vars: { name, verifyUrl: `${env.appUrl}/verify-email?token=${token}` } }).catch((e) => console.error("[register] email enqueue failed", e.message));
    // Tell the administrators there is someone to approve.
    const admins = await db.user.findMany({ where: { role: { in: ["SUPER_ADMIN", "ADMIN"] }, status: "ACTIVE" }, select: { email: true } });
    for (const a of admins) {
      await enqueueEmail({ resellerId: null, template: "admin_new_reseller", to: a.email, vars: { name, email, storeName, reviewUrl: `${env.appUrl}/admin/resellers/${user.reseller!.id}` } }).catch((e) => console.error("[register] admin email enqueue failed", e.message));
    }
    await audit({ actor: { id: user.id, email, role: "RESELLER" }, resellerId: user.reseller!.id, action: "reseller.registered", ip });
    await createUserSession(user.id, false);
    return { redirect: "/pending", message: "Request submitted. Check your inbox and confirm your email address — you will get another email when your account is approved." };
  });
}

export async function loginAction(fd: FormData) {
  return act("/login", async () => {
    const email = str(fd, "email", 254).toLowerCase();
    const password = str(fd, "password", 200);
    const ip = await clientIp();
    if (!(await rateLimit(`login:${ip}`, 20, 900)) || !(await rateLimit(`login:${email}`, 8, 900))) {
      throw new UserError("Too many login attempts. Wait 15 minutes and try again.");
    }
    const user = await db.user.findUnique({ where: { email } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      await audit({ action: "auth.login_failed", target: email, ip });
      throw new UserError("Incorrect email or password.");
    }
    if (user.status !== "ACTIVE") throw new UserError("This account is suspended. Contact support.");
    if (user.totpEnabled) {
      await createUserSession(user.id, true);
      return { redirect: "/login/2fa" };
    }
    await createUserSession(user.id, false);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ actor: { id: user.id, email, role: user.role }, action: "auth.login", ip });
    return { redirect: user.role === "RESELLER" ? "/dashboard" : "/admin" };
  });
}

export async function twoFactorAction(fd: FormData) {
  return act("/login/2fa", async () => {
    const user = await getPendingTwoFactorUser();
    if (!user || !user.totpSecretEnc) return { redirect: "/login" };
    if (!(await rateLimit(`2fa:${user.id}`, 6, 300))) throw new UserError("Too many attempts. Wait a few minutes.");
    if (!verifyTotp(decrypt(user.totpSecretEnc), str(fd, "code", 10))) throw new UserError("Invalid code. Check your authenticator app and try again.");
    await completeTwoFactor();
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ actor: { id: user.id, email: user.email, role: user.role }, action: "auth.login_2fa", ip: await clientIp() });
    return { redirect: user.role === "RESELLER" ? "/dashboard" : "/admin" };
  });
}

export async function logoutAction() {
  await destroyUserSession();
  return act("/login", async () => ({ redirect: "/login", message: "You have been signed out." }));
}

export async function forgotPasswordAction(fd: FormData) {
  return act("/forgot-password", async () => {
    const email = str(fd, "email", 254).toLowerCase();
    const ip = await clientIp();
    if (!(await rateLimit(`forgot:${ip}`, 5, 3600))) throw new UserError("Too many requests. Try again later.");
    const user = await db.user.findUnique({ where: { email } });
    if (user && user.status === "ACTIVE") {
      const token = await issueToken("PASSWORD_RESET", { userId: user.id }, 60);
      await enqueueEmail({ resellerId: null, template: "password_reset", to: email, vars: { name: user.name, resetUrl: `${env.appUrl}/reset-password?token=${token}` } }).catch(() => {});
    }
    // Same answer whether or not the account exists (no account enumeration).
    return "If an account exists for that email, a reset link is on its way.";
  });
}

export async function resetPasswordAction(fd: FormData) {
  const token = str(fd, "token", 200);
  return act(`/reset-password?token=${encodeURIComponent(token)}`, async () => {
    const password = str(fd, "password", 200);
    const pwErr = passwordPolicyError(password);
    if (pwErr) throw new UserError(pwErr);
    const t = await consumeToken("PASSWORD_RESET", token);
    if (!t?.userId) throw new UserError("This reset link is invalid or has expired.");
    await db.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password) } });
    await db.session.deleteMany({ where: { userId: t.userId } }); // sign out everywhere
    await audit({ actor: { id: t.userId, email: "", role: "USER" }, action: "auth.password_reset", ip: await clientIp() });
    return { redirect: "/login", message: "Password changed. You can sign in now." };
  });
}

/** "Resend confirmation email" on the waiting-for-approval page. */
export async function resendVerificationPendingAction() {
  const user = await getCurrentUser();
  return act("/pending", async () => {
    if (!user) return { redirect: "/login" };
    if (user.emailVerifiedAt) return "Email already confirmed.";
    if (!(await rateLimit(`verify:${user.id}`, 3, 3600))) throw new UserError("Please wait before requesting another email.");
    const token = await issueToken("EMAIL_VERIFY", { userId: user.id }, 24 * 60);
    await enqueueEmail({ resellerId: null, template: "verify_email", to: user.email, vars: { name: user.name, verifyUrl: `${env.appUrl}/verify-email?token=${token}` } });
    return "Confirmation email sent.";
  });
}
