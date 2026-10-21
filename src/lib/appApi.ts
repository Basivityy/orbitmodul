import { appCustomerEmail, deviceLimit, streamServer } from "@/core/appApi";
import { decrypt } from "@/core/crypto";
import { generateCode, normalizeCode } from "@/core/codes";
import { redeemCode } from "./codes";
import { db } from "./db";
import { CheckoutError } from "./orders";
import { loadResellerSaas, sellBlockers } from "./saas";
import { storeBaseUrl } from "./urls";

export { appCustomerEmail };

export class AppApiError extends Error {
  constructor(public readonly httpStatus: number, public readonly code: string, message: string) {
    super(message);
  }
}

export interface AppLoginResponse {
  status: "active" | "expired" | "activating" | "extending";
  server?: string;
  username?: string;
  password?: string;
  expiresAt?: string | null;
  maxConnections?: number;
  devices?: { used: number; limit: number };
  store: { name: string; extendUrl: string | null; contact: string | null };
  message?: string;
}

type Sub = NonNullable<Awaited<ReturnType<typeof loadSub>>>;

function loadSub(where: { id?: string; appCode?: string }) {
  return db.subscription.findFirst({ where, include: { panel: true, package: true, reseller: true, appDevices: true } });
}

function storeInfo(r: { storeName: string; slug: string; customDomain: string | null; customDomainVerified: boolean; contactEmail: string | null; contactTelegram: string | null; contactWhatsapp: string | null }) {
  return { name: r.storeName, extendUrl: `${storeBaseUrl(r as any)}/activate?mode=extend`, contact: r.contactEmail ?? r.contactWhatsapp ?? r.contactTelegram ?? null };
}

function code(raw: unknown): string {
  const c = typeof raw === "string" ? normalizeCode(raw) : null;
  if (!c) throw new AppApiError(400, "invalid_code", "Enter the 12-character code, e.g. A7K2-9QXM-4TPL.");
  return c;
}

/** The subscription a login code belongs to (links a redeemed activation code on first use). */
/** Optional `store` (slug) sent by a reseller's own app: only that store's codes are accepted. */
async function storeScope(store: unknown): Promise<string | null> {
  if (store === undefined || store === null || store === "") return null;
  if (typeof store !== "string" || !/^[a-z0-9-]{2,60}$/.test(store)) throw new AppApiError(400, "invalid_store", "Invalid store.");
  const r = await db.reseller.findUnique({ where: { slug: store }, select: { id: true } });
  if (!r) throw new AppApiError(404, "unknown_store", "Unknown store.");
  return r.id;
}

function checkScope(scope: string | null, resellerId: string) {
  if (scope && scope !== resellerId) throw new AppApiError(404, "unknown_code", "This code is not valid.");
}

async function resolveLogin(c: string): Promise<{ sub: Sub } | { pending: { status: string; error: string | null }; resellerId: string } | { unused: { resellerId: string } }> {
  const bySub = await loadSub({ appCode: c });
  if (bySub) return { sub: bySub };
  const ac = await db.activationCode.findUnique({ where: { code: c } });
  if (!ac || ac.status === "VOID") throw new AppApiError(404, "unknown_code", "This code is not valid.");
  if (ac.status === "UNUSED") return { unused: { resellerId: ac.resellerId } };
  const order = ac.orderId ? await db.order.findUnique({ where: { id: ac.orderId } }) : null;
  if (!order) throw new AppApiError(404, "unknown_code", "This code is not valid.");
  if (order.kind === "RENEWAL") throw new AppApiError(409, "extension_code", "This code was used to extend a line. Sign in with the code you activated the line with.");
  if (!order.subscriptionId) return { pending: { status: order.status, error: order.errorMessage }, resellerId: order.resellerId };
  const sub = await loadSub({ id: order.subscriptionId });
  if (!sub) throw new AppApiError(404, "unknown_code", "This code is not valid.");
  if (!sub.appCode) {
    await db.subscription.updateMany({ where: { id: sub.id, appCode: null }, data: { appCode: c } });
    sub.appCode = c;
  }
  if (sub.appCode !== c) throw new AppApiError(409, "extension_code", "Sign in with the code you activated the line with.");
  return { sub };
}

/** Registers the device (up to the package's connections) and returns the login details. */
async function loginPayload(sub: Sub, deviceId: string, deviceName: string | null): Promise<AppLoginResponse> {
  const limit = deviceLimit(sub.package.maxConnections);
  const known = sub.appDevices.find((d) => d.deviceId === deviceId);
  if (known) {
    await db.appDevice.update({ where: { id: known.id }, data: { lastSeenAt: new Date(), ...(deviceName ? { name: deviceName } : {}) } });
  } else {
    if (sub.appDevices.length >= limit) throw new AppApiError(403, "device_limit", `This code is already used on ${limit} device${limit > 1 ? "s" : ""}. Ask the store to reset your devices.`);
    await db.appDevice.create({ data: { subscriptionId: sub.id, deviceId, name: deviceName } }).catch(() => undefined);
  }
  const expired = !sub.expiresAt || sub.expiresAt < new Date() || sub.status !== "ACTIVE";
  const extending = await db.order.findFirst({ where: { subscriptionId: sub.id, kind: "RENEWAL", status: { in: ["PAID", "ACTIVATING"] } }, select: { id: true } });
  return {
    status: extending ? "extending" : expired ? "expired" : "active",
    server: streamServer(sub.panel),
    username: sub.lineUsername ?? undefined,
    password: sub.linePasswordEnc ? decrypt(sub.linePasswordEnc) : undefined,
    expiresAt: sub.expiresAt?.toISOString() ?? null,
    maxConnections: sub.package.maxConnections,
    devices: { used: known ? sub.appDevices.length : sub.appDevices.length + 1, limit },
    store: storeInfo(sub.reseller),
    message: expired ? "Your subscription has expired. Enter a new code to extend it." : undefined,
  };
}

async function assertStoreActive(resellerId: string) {
  const r = await loadResellerSaas(resellerId);
  const owner = await db.user.findUniqueOrThrow({ where: { id: r.ownerUserId } });
  if ((await sellBlockers(r, !!owner.emailVerifiedAt)).length) throw new AppApiError(403, "store_inactive", "This store is not active right now. Please contact the store.");
}

async function pendingPayload(resellerId: string, p: { status: string; error: string | null }): Promise<AppLoginResponse> {
  const r = await db.reseller.findUniqueOrThrow({ where: { id: resellerId } });
  if (p.status === "ACTIVATION_FAILED" || p.status === "ON_HOLD") throw new AppApiError(409, "activation_problem", "Your line could not be created yet. The store has been notified — please contact them.");
  return { status: "activating", store: storeInfo(r), message: "Your line is being created. Try again in a few seconds." };
}

/**
 * POST /api/app/v1/activate — the app sends a code:
 *  - unused activation code → the line is created (username/password generated) → "activating";
 *    the app calls again after a few seconds and gets the login details;
 *  - the code the line was activated with → login details (also on a new device, up to the limit).
 */
export async function appActivate(rawCode: unknown, deviceId: string, deviceName: string | null, store?: unknown): Promise<AppLoginResponse> {
  const scope = await storeScope(store);
  const c = code(rawCode);
  const r = await resolveLogin(c);
  if ("sub" in r) {
    checkScope(scope, r.sub.resellerId);
    return loginPayload(r.sub, deviceId, deviceName);
  }
  if ("pending" in r) {
    checkScope(scope, r.resellerId);
    return pendingPayload(r.resellerId, r.pending);
  }
  checkScope(scope, r.unused.resellerId);
  await assertStoreActive(r.unused.resellerId);
  try {
    await redeemCode(r.unused.resellerId, { mode: "app", code: c });
  } catch (e) {
    if (e instanceof CheckoutError) throw new AppApiError(409, "redeem_failed", e.message);
    throw e;
  }
  const reseller = await db.reseller.findUniqueOrThrow({ where: { id: r.unused.resellerId } });
  return { status: "activating", store: storeInfo(reseller), message: "Your line is being created. Try again in a few seconds." };
}

/** POST /api/app/v1/status — login code → current details (never redeems anything). */
export async function appStatus(rawLogin: unknown, deviceId: string, store?: unknown): Promise<AppLoginResponse> {
  const scope = await storeScope(store);
  const r = await resolveLogin(code(rawLogin));
  if ("unused" in r) {
    checkScope(scope, r.unused.resellerId);
    throw new AppApiError(409, "not_activated", "This code is not activated yet. Use activate first.");
  }
  if ("pending" in r) {
    checkScope(scope, r.resellerId);
    return pendingPayload(r.resellerId, r.pending);
  }
  checkScope(scope, r.sub.resellerId);
  if (!r.sub.appDevices.some((d) => d.deviceId === deviceId)) throw new AppApiError(403, "unknown_device", "Sign in on this device first (activate).");
  return loginPayload(r.sub, deviceId, null);
}

/** POST /api/app/v1/extend — login code + new activation code → the same line is extended. */
export async function appExtend(rawLogin: unknown, rawNew: unknown, deviceId: string, store?: unknown): Promise<AppLoginResponse> {
  const scope = await storeScope(store);
  const r = await resolveLogin(code(rawLogin));
  if (!("sub" in r)) throw new AppApiError(409, "not_activated", "Activate your first code before extending.");
  checkScope(scope, r.sub.resellerId);
  if (!r.sub.appDevices.some((d) => d.deviceId === deviceId)) throw new AppApiError(403, "unknown_device", "Sign in on this device first.");
  const n = code(rawNew);
  if (n === r.sub.appCode) throw new AppApiError(409, "same_code", "Enter a new code to extend.");
  const nc = await db.activationCode.findUnique({ where: { code: n }, select: { resellerId: true } });
  if (!nc || nc.resellerId !== r.sub.resellerId) throw new AppApiError(404, "unknown_code", "This code is not valid.");
  await assertStoreActive(r.sub.resellerId);
  try {
    await redeemCode(r.sub.resellerId, { mode: "extend", code: n, subscriptionId: r.sub.id });
  } catch (e) {
    if (e instanceof CheckoutError) throw new AppApiError(409, "redeem_failed", e.message);
    throw e;
  }
  const fresh = await loadSub({ id: r.sub.id });
  return { ...(await loginPayload(fresh!, deviceId, null)), status: "extending", message: "Your subscription is being extended. Check again in a few seconds." };
}

/** Reseller: give a line (bought on the store, created by hand, loaded) an app login code. */
export async function issueAppCode(resellerId: string, subscriptionId: string): Promise<string> {
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId, resellerId } });
  if (!sub) throw new CheckoutError("Subscription not found.");
  if (sub.appCode) return sub.appCode;
  for (let i = 0; i < 5; i++) {
    const c = generateCode();
    const clash = await db.activationCode.findUnique({ where: { code: c } });
    if (clash) continue;
    const r = await db.subscription.updateMany({ where: { id: sub.id, appCode: null }, data: { appCode: c } });
    if (r.count === 1) return c;
  }
  throw new CheckoutError("Could not create a code, please try again.");
}
