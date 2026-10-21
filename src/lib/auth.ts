import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Customer, Reseller, User } from "@prisma/client";
import { randomToken, sha256 } from "@/core/crypto";
import { db } from "./db";
import { env } from "./env";
import { clientIp, userAgent } from "./ratelimit";

export const USER_COOKIE = "xb_session";
export const CUSTOMER_COOKIE = "xb_customer";

async function setCookie(name: string, value: string, maxAgeSec: number) {
  (await cookies()).set(name, value, { httpOnly: true, secure: env.secureCookies, sameSite: "lax", path: "/", maxAge: maxAgeSec });
}

export async function createUserSession(userId: string, twoFactorPending: boolean): Promise<void> {
  const token = randomToken(32);
  const days = twoFactorPending ? 1 / 96 : env.sessionDays; // pending 2FA sessions live 15 minutes
  await db.session.create({
    data: {
      tokenHash: sha256(token),
      kind: "USER",
      userId,
      twoFactorPending,
      ip: await clientIp(),
      userAgent: await userAgent(),
      expiresAt: new Date(Date.now() + days * 86_400_000),
    },
  });
  await setCookie(USER_COOKIE, token, Math.ceil(days * 86_400));
}

export async function destroyUserSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(USER_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  c.delete(USER_COOKIE);
}

async function sessionFromCookie(name: string) {
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true, customer: true } });
  if (!s || s.expiresAt.getTime() < Date.now()) return null;
  return s;
}

/** Session in the "password OK, waiting for 2FA code" state. */
export async function getPendingTwoFactorUser(): Promise<User | null> {
  const s = await sessionFromCookie(USER_COOKIE);
  return s && s.kind === "USER" && s.twoFactorPending && s.user ? s.user : null;
}

export async function completeTwoFactor(): Promise<void> {
  const token = (await cookies()).get(USER_COOKIE)?.value;
  if (!token) return;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!s?.userId) return;
  await db.session.delete({ where: { id: s.id } });
  await createUserSession(s.userId, false);
}

export async function getCurrentUser(): Promise<User | null> {
  const s = await sessionFromCookie(USER_COOKIE);
  if (!s || s.kind !== "USER" || s.twoFactorPending || !s.user) return null;
  if (s.user.status !== "ACTIVE") return null;
  return s.user;
}

export async function requireUser(): Promise<User> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/**
 * Every reseller page and server action calls this. It returns the reseller owned by the
 * logged-in user — all tenant queries must use `reseller.id` from here, never an id from the client.
 */
export async function requireReseller(): Promise<{ user: User; reseller: Reseller }> {
  const user = await requireUser();
  if (user.role !== "RESELLER") redirect("/admin");
  const reseller = await db.reseller.findUnique({ where: { ownerUserId: user.id } });
  if (!reseller) redirect("/login");
  if (reseller.status === "SUSPENDED") redirect("/suspended");
  if (reseller.approvalStatus !== "APPROVED") redirect("/pending");
  return { user, reseller };
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") redirect("/dashboard");
  return user;
}

export async function requireSuperAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect("/admin");
  return user;
}

export function actorOf(user: User) {
  return { id: user.id, email: user.email, role: user.role };
}

// ---------------------------------------------------------------- customers (per store)

export async function createCustomerSession(customerId: string): Promise<void> {
  const token = randomToken(32);
  await db.session.create({
    data: { tokenHash: sha256(token), kind: "CUSTOMER", customerId, ip: await clientIp(), userAgent: await userAgent(), expiresAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  await setCookie(CUSTOMER_COOKIE, token, 30 * 86_400);
}

export async function getCurrentCustomer(resellerId: string): Promise<Customer | null> {
  const s = await sessionFromCookie(CUSTOMER_COOKIE);
  if (!s || s.kind !== "CUSTOMER" || !s.customer) return null;
  // A customer session is only valid on the store it belongs to.
  return s.customer.resellerId === resellerId ? s.customer : null;
}

export async function destroyCustomerSession(): Promise<void> {
  const c = await cookies();
  const token = c.get(CUSTOMER_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  c.delete(CUSTOMER_COOKIE);
}

// ---------------------------------------------------------------- one-time tokens

export async function issueToken(type: "EMAIL_VERIFY" | "PASSWORD_RESET" | "CUSTOMER_LOGIN", ref: { userId?: string; customerId?: string }, ttlMinutes: number): Promise<string> {
  const token = randomToken(32);
  await db.token.create({ data: { type, tokenHash: sha256(token), userId: ref.userId, customerId: ref.customerId, expiresAt: new Date(Date.now() + ttlMinutes * 60_000) } });
  return token;
}

/** Atomically consumes a token; returns its owner or null if invalid/expired/used. */
export async function consumeToken(type: "EMAIL_VERIFY" | "PASSWORD_RESET" | "CUSTOMER_LOGIN", token: string) {
  const t = await db.token.findUnique({ where: { tokenHash: sha256(token) } });
  if (!t || t.type !== type || t.usedAt || t.expiresAt.getTime() < Date.now()) return null;
  const res = await db.token.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return res.count === 1 ? t : null;
}
