import type { Order, Subscription } from "@prisma/client";
import { decrypt } from "@/core/crypto";
import { streamServer } from "@/core/appApi";
import { packageSellable } from "@/core/catalog";
import { isValidEmail } from "@/core/ids";
import { isPlaceholderEmail, placeholderEmail } from "@/core/importedCustomers";
import { apiOrderStatus, hashApiKey, keyFromHeaders, parseAmount, PartnerApiError, validExternalRef } from "@/core/partnerApi";
import { effectivePrice } from "@/core/pricing";
import { customerUsernameError } from "@/core/usernames";
import { normalizeCode } from "@/core/codes";
import { packageBouquetNames } from "./bouquetCatalog";
import { createCodes, MAX_CODES_PER_BATCH } from "./codes";
import { db, isUniqueViolation } from "./db";
import { CheckoutError, createManualOrder, createManualRenewal, usernameTaken } from "./orders";
import { rateLimit } from "./ratelimit";
import { loadResellerSaas, sellBlockers } from "./saas";

/**
 * Website API (server-to-server, Bearer key): a reseller's own website sells and the module
 * creates / extends the lines. Payment happens on the reseller's site — every call with a valid
 * key is trusted as paid, like "Add customer" in the dashboard.
 */
export type ApiReseller = { id: string; storeName: string; defaultCurrency: string };

export async function authenticate(req: Request): Promise<{ reseller: ApiReseller; keyId: string }> {
  const key = keyFromHeaders(req.headers);
  if (!key) throw new PartnerApiError(401, "unauthorized", "Send your API key: Authorization: Bearer om_live_…");
  const row = await db.resellerApiKey.findUnique({ where: { keyHash: hashApiKey(key) }, include: { reseller: true } });
  if (!row || row.revokedAt) throw new PartnerApiError(401, "unauthorized", "This API key is not valid (deleted or wrong).");
  const r = row.reseller;
  if (!r.partnerApiEnabled) throw new PartnerApiError(403, "api_disabled", "The Website API is switched off for this account. Contact the platform administrator.");
  if (r.status !== "ACTIVE" || r.approvalStatus !== "APPROVED") throw new PartnerApiError(403, "account_inactive", "This reseller account is not active.");
  if (!(await rateLimit(`papi:${row.id}`, 240, 60))) throw new PartnerApiError(429, "rate_limited", "Too many requests (max 240 per minute).");
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await db.resellerApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { reseller: { id: r.id, storeName: r.storeName, defaultCurrency: r.defaultCurrency }, keyId: row.id };
}

async function assertCanSell(resellerId: string) {
  const full = await loadResellerSaas(resellerId);
  const owner = await db.user.findUniqueOrThrow({ where: { id: full.ownerUserId } });
  const blockers = await sellBlockers(full, !!owner.emailVerifiedAt);
  if (blockers.length) throw new PartnerApiError(403, "store_inactive", blockers[0]);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ── serializers ────────────────────────────────────────────────────────────────

export async function serializeLine(sub: Subscription & { package?: { id: string; name: string } | null }) {
  const panel = await db.panelIntegration.findUnique({ where: { id: sub.panelId }, select: { streamUrl: true, apiUrl: true } });
  const customer = await db.customer.findUnique({ where: { id: sub.customerId }, select: { email: true, name: true, phone: true } });
  const pkg = sub.package ?? (await db.package.findUnique({ where: { id: sub.packageId }, select: { id: true, name: true } }));
  return {
    id: sub.id,
    username: sub.lineUsername,
    password: sub.linePasswordEnc ? decrypt(sub.linePasswordEnc) : null,
    server_url: panel ? streamServer(panel) : null,
    status: sub.status.toLowerCase(),
    expires_at: iso(sub.expiresAt),
    package: pkg ? { id: pkg.id, name: pkg.name } : null,
    customer: customer ? { email: isPlaceholderEmail(customer.email) ? null : customer.email, name: customer.name, phone: customer.phone ? `+${customer.phone}` : null } : null,
    maxplayer: sub.maxPlayerStatus === "NONE" ? null : sub.maxPlayerStatus.toLowerCase(),
    app_code: sub.appCode,
    created_at: iso(sub.createdAt),
  };
}

export async function serializeOrder(o: Order) {
  const status = apiOrderStatus(o.status);
  const sub = o.subscriptionId ? await db.subscription.findUnique({ where: { id: o.subscriptionId }, include: { package: { select: { id: true, name: true } } } }) : null;
  const ref = o.idempotencyKey.startsWith(`api:${o.resellerId}:`) ? o.idempotencyKey.slice(`api:${o.resellerId}:`.length) : null;
  return {
    id: o.id,
    number: o.number,
    type: o.kind === "RENEWAL" ? "extend" : "new",
    status,
    external_ref: ref,
    amount_minor: o.amountCents,
    currency: o.currency,
    created_at: iso(o.createdAt),
    error: status === "failed" ? o.errorMessage : null,
    line: status === "completed" && sub ? await serializeLine(sub) : null,
  };
}

/** Optional `wait` (seconds, max 25): returns as soon as the line is active or failed. */
async function waitForOrder(orderId: string, waitSec: number): Promise<Order> {
  const until = Date.now() + Math.min(Math.max(waitSec, 0), 25) * 1000;
  for (;;) {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const st = apiOrderStatus(o.status);
    if (st === "completed" || st === "failed" || Date.now() >= until) return o;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function waitParam(body: Record<string, unknown>): number {
  const w = Number(body.wait ?? 0);
  return Number.isFinite(w) ? w : 0;
}

async function ownPackage(resellerId: string, id: unknown) {
  const pkg = typeof id === "string" && id ? await db.package.findFirst({ where: { id, resellerId }, include: { panel: { select: { apiUrl: true } } } }) : null;
  if (!pkg) throw new PartnerApiError(404, "package_not_found", "package_id: no such package. GET /packages lists them.");
  if (!packageSellable(pkg)) throw new PartnerApiError(409, "package_not_linked", "This package is not linked to a panel package — set “Panel package” on it first.");
  return pkg;
}

/** Same external_ref → same order (safe to retry after a timeout). */
async function existingByRef(resellerId: string, ref: string | null): Promise<Order | null> {
  return ref ? db.order.findUnique({ where: { idempotencyKey: `api:${resellerId}:${ref}` } }) : null;
}

// ── operations ────────────────────────────────────────────────────────────────

export async function listPackages(r: ApiReseller) {
  const pkgs = await db.package.findMany({ where: { resellerId: r.id, active: true }, orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }], include: { panel: { select: { apiUrl: true } }, bouquets: { include: { bouquet: { select: { name: true, externalId: true } } } } } });
  const out = [];
  for (const p of pkgs.filter(packageSellable)) {
    const price = effectivePrice(p);
    const bq = await packageBouquetNames(p.panel.apiUrl, p.bouquets.map((b) => b.bouquet));
    out.push({ id: p.id, name: p.name, description: p.description, price_minor: price.amount, regular_price_minor: p.priceCents, currency: p.currency, duration_days: p.durationDays, connections: p.maxConnections, maxplayer: p.maxPlayerEnabled, trial: p.isTrial, bouquets: bq.names, unnamed_bouquets: bq.unnamed });
  }
  return { packages: out };
}

export async function checkUsername(r: ApiReseller, username: string) {
  const err = customerUsernameError(username);
  if (err) return { username, available: false, reason: err };
  return { username, available: !(await usernameTaken(r.id, username)) };
}

/** POST /lines — new line, paid on the reseller's site. */
export async function createLine(r: ApiReseller, body: Record<string, unknown>) {
  const ref = validExternalRef(body.external_ref);
  const prev = await existingByRef(r.id, ref);
  if (prev) return serializeOrder(await waitForOrder(prev.id, waitParam(body)));
  await assertCanSell(r.id);
  const pkg = await ownPackage(r.id, body.package_id);
  const username = body.username === undefined || body.username === null || body.username === "" ? undefined : String(body.username).trim();
  if (username) {
    const err = customerUsernameError(username);
    if (err) throw new PartnerApiError(400, "invalid_username", err);
    if (await usernameTaken(r.id, username)) throw new PartnerApiError(409, "username_taken", `The username "${username}" is already taken.`);
  }
  const emailRaw = body.email ? String(body.email).trim().toLowerCase() : "";
  if (emailRaw && !isValidEmail(emailRaw)) throw new PartnerApiError(400, "invalid_email", "email is not a valid address.");
  const amount = parseAmount(body) ?? effectivePrice(pkg).amount;
  try {
    const o = await createManualOrder({
      resellerId: r.id,
      email: emailRaw || placeholderEmail(username ?? `api-${Date.now().toString(36)}`),
      name: body.name ? String(body.name).slice(0, 100) : undefined,
      packageId: pkg.id,
      amountMinor: amount,
      username,
      notifyCustomer: body.send_email === false ? false : !!emailRaw,
      note: body.note ? String(body.note).slice(0, 300) : undefined,
      idempotencyKey: ref ? `api:${r.id}:${ref}` : undefined,
      numberPrefix: "API",
    });
    return serializeOrder(await waitForOrder(o.id, waitParam(body)));
  } catch (e) {
    if (isUniqueViolation(e) && ref) {
      const o = await existingByRef(r.id, ref);
      if (o) return serializeOrder(o);
    }
    if (e instanceof CheckoutError) throw new PartnerApiError(409, "cannot_create", e.message);
    throw e;
  }
}

async function findLine(resellerId: string, body: Record<string, unknown>) {
  if (body.line_id) {
    const s = await db.subscription.findFirst({ where: { id: String(body.line_id), resellerId, xuiLineId: { not: null } } });
    if (s) return s;
  } else if (body.username) {
    const s = await db.subscription.findFirst({ where: { resellerId, lineUsername: { equals: String(body.username).trim(), mode: "insensitive" }, xuiLineId: { not: null } }, orderBy: { createdAt: "desc" } });
    if (s) return s;
  } else {
    throw new PartnerApiError(400, "line_required", "Send line_id or username of the line to extend.");
  }
  throw new PartnerApiError(404, "line_not_found", "No line with this id / username in your billing. Lines that exist only on the panel: import them first (Customers → Load existing line).");
}

/** POST /lines/extend — extension paid on the reseller's site. */
export async function extendLine(r: ApiReseller, body: Record<string, unknown>) {
  const ref = validExternalRef(body.external_ref);
  const prev = await existingByRef(r.id, ref);
  if (prev) return serializeOrder(await waitForOrder(prev.id, waitParam(body)));
  await assertCanSell(r.id);
  const sub = await findLine(r.id, body);
  const pkg = await ownPackage(r.id, body.package_id);
  const amount = parseAmount(body) ?? effectivePrice(pkg).amount;
  // An imported line without email gets the customer's email now.
  const email = body.email ? String(body.email).trim().toLowerCase() : "";
  if (email && isValidEmail(email)) {
    const c = await db.customer.findUnique({ where: { id: sub.customerId } });
    if (c && isPlaceholderEmail(c.email) && !(await db.customer.findUnique({ where: { resellerId_email: { resellerId: r.id, email } } }))) await db.customer.update({ where: { id: c.id }, data: { email } });
  }
  try {
    const o = await createManualRenewal({ resellerId: r.id, subscriptionId: sub.id, packageId: pkg.id, amountMinor: amount, idempotencyKey: ref ? `api:${r.id}:${ref}` : undefined, numberPrefix: "API" });
    return serializeOrder(await waitForOrder(o.id, waitParam(body)));
  } catch (e) {
    if (isUniqueViolation(e) && ref) {
      const o = await existingByRef(r.id, ref);
      if (o) return serializeOrder(o);
    }
    if (e instanceof CheckoutError) throw new PartnerApiError(409, "cannot_extend", e.message);
    throw e;
  }
}

export async function getOrder(r: ApiReseller, id: string) {
  const o = await db.order.findFirst({ where: { resellerId: r.id, OR: [{ id }, { number: id }, { idempotencyKey: `api:${r.id}:${id}` }] } });
  if (!o) throw new PartnerApiError(404, "order_not_found", "No such order.");
  return serializeOrder(o);
}

/** GET /lines?username=… | ?email=… */
export async function findLines(r: ApiReseller, q: URLSearchParams) {
  const username = q.get("username")?.trim();
  const email = q.get("email")?.trim().toLowerCase();
  if (!username && !email) throw new PartnerApiError(400, "query_required", "Use ?username=… or ?email=…");
  const subs = await db.subscription.findMany({
    where: { resellerId: r.id, isTest: false, xuiLineId: { not: null }, ...(username ? { lineUsername: { equals: username, mode: "insensitive" as const } } : { customer: { email } }) },
    include: { package: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return { lines: await Promise.all(subs.map((s) => serializeLine(s))) };
}

export async function getLine(r: ApiReseller, id: string) {
  const s = await db.subscription.findFirst({ where: { id, resellerId: r.id }, include: { package: { select: { id: true, name: true } } } });
  if (!s) throw new PartnerApiError(404, "line_not_found", "No such line.");
  return serializeLine(s);
}

/** POST /codes — activation codes to sell on the website (e.g. one per order). */
export async function createCodesApi(r: ApiReseller, body: Record<string, unknown>) {
  const pkg = await ownPackage(r.id, body.package_id);
  const count = Number(body.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CODES_PER_BATCH) throw new PartnerApiError(400, "invalid_count", `count: 1–${MAX_CODES_PER_BATCH}`);
  const batch = body.batch ? String(body.batch).slice(0, 60) : "api";
  const codes = await createCodes(r.id, pkg.id, count, batch);
  return { package_id: pkg.id, codes };
}

export async function getCode(r: ApiReseller, raw: string) {
  const code = normalizeCode(raw) ?? raw;
  const c = await db.activationCode.findFirst({ where: { code, resellerId: r.id } });
  if (!c) throw new PartnerApiError(404, "code_not_found", "No such code.");
  return { code: c.code, status: c.status.toLowerCase(), package_id: c.packageId, used_at: iso(c.usedAt), used_by_email: c.usedByEmail, line_username: c.lineUsername, line_id: c.subscriptionId };
}

