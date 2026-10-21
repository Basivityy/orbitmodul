import { isPlaceholderEmail } from "@/core/importedCustomers";
import { customerUsernameError } from "@/core/usernames";
import type { Order, PaymentProvider, Prisma } from "@prisma/client";
import { encrypt, decrypt, randomToken } from "@/core/crypto";
import { formatMoney } from "@/core/money";
import { orderNumber } from "@/core/ids";
import { applyCoupon, effectivePrice } from "@/core/pricing";
import type { PackageSnapshot } from "@/core/activation/engine";
import { PaymentEvent } from "@/core/payments";
import { audit } from "./audit";
import { db, isUniqueViolation } from "./db";
import { env } from "./env";
import { loadGateway } from "./gateways";
import { resellerPlansEnabled, storeTestPaymentsEnabled } from "./settings";
import { enqueueActivation, enqueueEmail } from "./queue";
import { storeBaseUrl, webhookUrl } from "./urls";

export class CheckoutError extends Error {}

/** Plan limit: number of distinct customers with an active subscription. */
export async function assertCustomerCapacity(resellerId: string, customerId: string, message: string): Promise<void> {
  if (!(await resellerPlansEnabled())) return; // free platform: no customer limit
  const saas = await db.saasSubscription.findUnique({ where: { resellerId }, include: { plan: true } });
  if (!saas) return;
  const alreadyActive = await db.subscription.count({ where: { resellerId, customerId, status: "ACTIVE" } });
  if (alreadyActive) return;
  const active = await db.subscription.findMany({ where: { resellerId, status: "ACTIVE" }, distinct: ["customerId"], select: { customerId: true } });
  if (active.length >= saas.plan.maxActiveCustomers) throw new CheckoutError(message);
}

/**
 * Customer added by hand by the reseller (cash, bank transfer or free). The order is created
 * already PAID with provider MANUAL and goes through the normal activation engine, so the line
 * is created on the panel exactly like for an online purchase. Paid amounts count as revenue.
 */
export async function createManualOrder(input: {
  resellerId: string;
  email: string;
  name?: string;
  packageId: string;
  amountMinor: number; // 0 = free
  durationDays?: number; // override package duration
  username?: string;
  password?: string;
  notifyCustomer: boolean;
  maxPlayer?: boolean; // override the package setting
  note?: string;
}): Promise<Order> {
  const pkg = await db.package.findFirst({ where: { id: input.packageId, resellerId: input.resellerId } });
  if (!pkg) throw new CheckoutError("Package not found.");
  const email = input.email.trim().toLowerCase();
  const customer = await db.customer.upsert({
    where: { resellerId_email: { resellerId: input.resellerId, email } },
    create: { resellerId: input.resellerId, email, name: input.name?.trim() || null, notes: input.note ?? null },
    update: input.name ? { name: input.name.trim() } : {},
  });
  await assertCustomerCapacity(input.resellerId, customer.id, "Your plan's active customer limit is reached. Upgrade your plan to add more customers.");
  if (input.username && (await db.subscription.findFirst({ where: { resellerId: input.resellerId, lineUsername: input.username } }))) {
    throw new CheckoutError("A subscription with this line username already exists.");
  }
  const snap = await snapshotPackage(pkg.id, input.resellerId, input.amountMinor, pkg.currency);
  if (input.durationDays) snap.durationDays = input.durationDays;
  if (input.maxPlayer !== undefined) snap.maxPlayerEnabled = input.maxPlayer;
  if (input.note?.trim()) snap.panelNote = input.note.trim().slice(0, 500);
  const id = randomToken(10);
  const order = await db.order.create({
    data: {
      number: orderNumber("MAN"),
      resellerId: input.resellerId,
      customerId: customer.id,
      packageId: pkg.id,
      kind: "NEW",
      status: "PAID",
      paidAt: new Date(),
      amountCents: input.amountMinor,
      currency: pkg.currency,
      provider: "MANUAL",
      providerPaymentId: `manual-${id}`,
      packageSnapshot: snap as unknown as Prisma.InputJsonValue,
      accessToken: randomToken(24),
      idempotencyKey: `manual-${id}`,
      notifyCustomer: input.notifyCustomer,
      // Reseller-chosen credentials: used by the engine instead of generated ones.
      lineUsername: input.username || null,
      linePasswordEnc: input.password ? encrypt(input.password) : null,
    },
  });
  if (input.amountMinor > 0) {
    await db.transaction.create({ data: { resellerId: input.resellerId, orderId: order.id, type: "PAYMENT", status: "SUCCEEDED", amountCents: input.amountMinor, currency: pkg.currency, provider: "MANUAL", providerRef: `manual-${id}` } });
  }
  await createInvoice(order.id);
  await enqueueActivation(order.id).catch((e) => console.error("[queue] activation enqueue failed; sweeper will retry", e.message));
  return order;
}

/** Build the immutable snapshot of what was sold. Activation uses this, not the live package. */
/** Username already used by a line of this store, or reserved by an order that is being paid right now. */
export async function usernameTaken(resellerId: string, username: string): Promise<boolean> {
  const u = { equals: username, mode: "insensitive" as const };
  if (await db.subscription.findFirst({ where: { resellerId, lineUsername: u }, select: { id: true } })) return true;
  const recent = new Date(Date.now() - 2 * 3600_000);
  return !!(await db.order.findFirst({ where: { resellerId, lineUsername: u, kind: "NEW", OR: [{ status: { in: ["PAID", "ACTIVATING", "ON_HOLD", "ACTIVATION_FAILED"] } }, { status: "PENDING", createdAt: { gt: recent } }] }, select: { id: true } }));
}

/**
 * Renewal by line username: the order belongs to the line's customer. A line imported from the
 * panel has no email yet — the email entered at checkout becomes the customer's email (or, if that
 * email is already a customer of this store, the line is moved to that customer).
 */
async function customerForLineRenewal(resellerId: string, subscriptionId: string, packagePanelId: string, email: string) {
  const sub = await db.subscription.findFirst({ where: { id: subscriptionId, resellerId }, include: { customer: true } });
  if (!sub) throw new CheckoutError("Subscription not found.");
  if (sub.panelId !== packagePanelId) throw new CheckoutError("This package cannot be used to extend your line. Please choose another one.");
  if (!isPlaceholderEmail(sub.customer.email)) return sub.customer;
  const owner = await db.customer.findUnique({ where: { resellerId_email: { resellerId, email } } });
  if (owner) {
    await db.subscription.update({ where: { id: sub.id }, data: { customerId: owner.id } });
    const left = await db.subscription.count({ where: { customerId: sub.customerId } });
    if (!left) await db.customer.delete({ where: { id: sub.customerId } }).catch(() => undefined);
    return owner;
  }
  return db.customer.update({ where: { id: sub.customerId }, data: { email, notes: sub.customer.notes } });
}

export async function snapshotPackage(packageId: string, resellerId: string, priceMinor: number, currency: string): Promise<PackageSnapshot> {
  const pkg = await db.package.findFirstOrThrow({ where: { id: packageId, resellerId }, include: { bouquets: { include: { bouquet: true } } } });
  return {
    packageId: pkg.id,
    name: pkg.name,
    durationDays: pkg.durationDays,
    maxConnections: pkg.maxConnections,
    bouquetIds: pkg.bouquets.map((b) => b.bouquet.externalId),
    maxPlayerEnabled: pkg.maxPlayerEnabled,
    isTrial: pkg.isTrial,
    panelPackageId: pkg.externalPackageId,
    priceMinor,
    currency,
    billingType: pkg.billingType,
  };
}

/**
 * Creates a pending order and a provider checkout. Prices always come from the database
 * (never from the client). Returns the URL to redirect the buyer to.
 */
export async function startCheckout(input: {
  resellerId: string;
  packageId: string;
  email: string;
  name?: string;
  provider: PaymentProvider;
  couponCode?: string;
  renewSubscriptionId?: string;
  /** Renewal started from "enter your username" (signed link) instead of the logged-in portal. */
  renewByLine?: boolean;
  /** Simulated payment on the public store (only while the Super Admin test mode is on). */
  storeTestPayment?: boolean;
  /** New line: username chosen by the customer (validated by customerUsernameError). */
  lineUsername?: string;
  idempotencyKey: string;
  siteBase?: string; // store base URL (custom domain aware)
}): Promise<{ redirectUrl: string; order: Order }> {
  const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) throw new CheckoutError("This checkout was already submitted. Please refresh the page.");

  const reseller = await db.reseller.findUniqueOrThrow({ where: { id: input.resellerId } });
  const pkg = await db.package.findFirst({ where: { id: input.packageId, resellerId: reseller.id, active: true } });
  if (!pkg) throw new CheckoutError("This package is not available.");
  // Store test mode (Super Admin switch): "Test payment" works for every store without a gateway.
  const storeTest = input.provider === "TEST" && input.storeTestPayment === true && (await storeTestPaymentsEnabled());
  const gw = storeTest ? null : await loadGateway(reseller.id, input.provider);
  if (!storeTest && (!gw || !gw.row.enabled)) throw new CheckoutError("This payment method is not available.");

  if (!input.renewSubscriptionId) {
    const u = input.lineUsername ?? "";
    const err = customerUsernameError(u);
    if (err) throw new CheckoutError(err);
    if (await usernameTaken(reseller.id, u)) throw new CheckoutError(`The username "${u}" is already taken. Please choose another one.`);
  }

  const email = input.email.trim().toLowerCase();
  const customer = input.renewByLine && input.renewSubscriptionId
    ? await customerForLineRenewal(reseller.id, input.renewSubscriptionId, pkg.panelId, email)
    : await db.customer.upsert({
        where: { resellerId_email: { resellerId: reseller.id, email } },
        create: { resellerId: reseller.id, email, name: input.name?.trim() || null },
        update: input.name ? { name: input.name.trim() } : {},
      });

  if (!input.renewSubscriptionId) await assertCustomerCapacity(reseller.id, customer.id, "This store has reached its customer limit. Please contact the store.");

  let renewal: { id: string } | null = null;
  if (input.renewSubscriptionId) {
    renewal = await db.subscription.findFirst({ where: { id: input.renewSubscriptionId, resellerId: reseller.id, customerId: customer.id }, select: { id: true } });
    if (!renewal) throw new CheckoutError("Subscription not found.");
  }

  const { amount: subtotal } = effectivePrice(pkg);
  let discount = 0;
  let couponId: string | null = null;
  if (input.couponCode) {
    const coupon = await db.coupon.findUnique({ where: { resellerId_code: { resellerId: reseller.id, code: input.couponCode.trim().toUpperCase() } } });
    if (!coupon) throw new CheckoutError("Coupon code not found.");
    const r = applyCoupon(subtotal, pkg.currency, pkg.id, coupon);
    if (!r.ok) throw new CheckoutError(r.error);
    discount = r.discount;
    couponId = coupon.id;
  }
  const total = subtotal - discount;
  const recurring = !!gw && pkg.billingType === "RECURRING" && !renewal && gw.impl.supportsRecurring && total > 0;

  const order = await db.order.create({
    data: {
      number: orderNumber(),
      resellerId: reseller.id,
      customerId: customer.id,
      packageId: pkg.id,
      subscriptionId: renewal?.id ?? null,
      kind: renewal ? "RENEWAL" : "NEW",
      lineUsername: renewal ? null : input.lineUsername ?? null,
      status: "PENDING",
      amountCents: total,
      discountCents: discount,
      currency: pkg.currency,
      couponId,
      provider: input.provider,
      packageSnapshot: (await snapshotPackage(pkg.id, reseller.id, total, pkg.currency)) as unknown as Prisma.InputJsonValue,
      accessToken: randomToken(24),
      idempotencyKey: input.idempotencyKey,
    },
  });

  const base = input.siteBase ?? storeBaseUrl(reseller);
  if (total === 0) {
    // Fully discounted: no payment provider round-trip.
    await handlePaymentEvents(reseller.id, input.provider, [{ type: "payment.succeeded", eventId: `free:${order.id}`, orderId: order.id, providerPaymentId: `free-${order.id}`, amountMinor: 0, currency: pkg.currency }]);
    return { redirectUrl: `${base}/order/${order.accessToken}`, order };
  }

  if (storeTest || !gw) {
    await db.order.update({ where: { id: order.id }, data: { providerRef: `test_${order.id}` } });
    return { redirectUrl: `${base}/test-pay/${order.accessToken}`, order };
  }

  try {
    const res = await gw.impl.createCheckout(
      gw.creds,
      {
        orderId: order.id,
        orderNumber: order.number,
        amountMinor: total,
        currency: pkg.currency,
        description: `${pkg.name} — ${pkg.durationDays} days`,
        customerEmail: email,
        successUrl: `${base}/order/${order.accessToken}`,
        cancelUrl: `${base}?canceled=1`,
        webhookUrl: webhookUrl(input.provider, gw.row.webhookToken),
        recurring: recurring ? { durationDays: pkg.durationDays } : undefined,
      },
      gw.opts,
    );
    await db.order.update({ where: { id: order.id }, data: { providerRef: res.providerRef } });
    return { redirectUrl: res.redirectUrl, order };
  } catch (e) {
    await db.order.update({ where: { id: order.id }, data: { status: "FAILED", errorMessage: String((e as Error).message).slice(0, 500) } });
    await db.apiLog.create({ data: { resellerId: reseller.id, service: input.provider, action: "create_checkout", success: false, message: String((e as Error).message).slice(0, 500), orderId: order.id } });
    throw new CheckoutError("The payment provider could not start the checkout. Please try again or choose another method.");
  }
}

async function findOrderForEvent(resellerId: string, provider: PaymentProvider, ev: { orderId?: string | null; providerRef?: string | null }) {
  if (ev.orderId) {
    const o = await db.order.findFirst({ where: { id: ev.orderId, resellerId } });
    if (o) return o;
  }
  if (ev.providerRef) return db.order.findFirst({ where: { providerRef: ev.providerRef, resellerId, provider } });
  return null;
}

async function onPaid(resellerId: string, provider: PaymentProvider, ev: Extract<PaymentEvent, { type: "payment.succeeded" }>) {
  const order = await findOrderForEvent(resellerId, provider, ev);
  if (!order) throw new Error(`Order not found for event ${ev.eventId}`);

  // Never trust a payment that does not match what we charged.
  if (ev.amountMinor != null && (ev.amountMinor !== order.amountCents || (ev.currency && ev.currency.toUpperCase() !== order.currency.toUpperCase()))) {
    // FAILED (not ON_HOLD): an ON_HOLD order is claimable for activation, a mismatched payment must never be.
    await db.order.updateMany({ where: { id: order.id, status: "PENDING" }, data: { status: "FAILED", errorMessage: `Amount mismatch — review manually: paid ${ev.amountMinor} ${ev.currency}, expected ${order.amountCents} ${order.currency}` } });
    await audit({ resellerId, action: "payment.amount_mismatch", target: order.id, meta: { paid: ev.amountMinor, currency: ev.currency } });
    return;
  }

  // Idempotent state transition — only the first event wins.
  const res = await db.order.updateMany({
    where: { id: order.id, status: { in: ["PENDING", "FAILED", "CANCELED"] } },
    data: { status: "PAID", paidAt: new Date(), providerPaymentId: ev.providerPaymentId, providerRef: order.providerRef ?? ev.providerRef ?? null, providerSubscriptionId: ev.providerSubscriptionId ?? null, errorMessage: null },
  });
  if (res.count === 0) return;

  try {
    await db.transaction.create({ data: { resellerId, orderId: order.id, type: "PAYMENT", status: "SUCCEEDED", amountCents: order.amountCents, currency: order.currency, provider, providerRef: ev.providerPaymentId, subscriptionId: order.subscriptionId } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  await createInvoice(order.id);
  if (order.couponId) await db.coupon.update({ where: { id: order.couponId }, data: { redemptions: { increment: 1 } } });

  await enqueueActivation(order.id).catch((e) => console.error("[queue] activation enqueue failed; sweeper will retry", e.message));
  const reseller = await db.reseller.findUniqueOrThrow({ where: { id: resellerId } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: order.customerId } });
  const snap = order.packageSnapshot as unknown as PackageSnapshot;
  await enqueueEmail({
    resellerId,
    template: "purchase_received",
    to: customer.email,
    vars: { orderNumber: order.number, packageName: snap.name, amount: formatMoney(order.amountCents, order.currency), portalUrl: `${storeBaseUrl(reseller)}/portal` },
  }).catch(() => {});
}

async function onRenewed(resellerId: string, provider: PaymentProvider, ev: Extract<PaymentEvent, { type: "subscription.renewed" }>) {
  const sub = await db.subscription.findFirst({ where: { resellerId, provider, providerSubscriptionId: ev.providerSubscriptionId } });
  if (!sub) throw new Error(`Subscription ${ev.providerSubscriptionId} not found`);
  const snap = await snapshotPackage(sub.packageId, resellerId, ev.amountMinor, ev.currency);
  // Contracted terms: duration and price of the existing subscription.
  snap.durationDays = sub.durationDays;
  let order: Order;
  try {
    order = await db.order.create({
      data: {
        number: orderNumber("REN"),
        resellerId,
        customerId: sub.customerId,
        packageId: sub.packageId,
        subscriptionId: sub.id,
        kind: "RENEWAL",
        status: "PAID",
        paidAt: new Date(),
        amountCents: ev.amountMinor,
        currency: ev.currency,
        provider,
        providerPaymentId: ev.providerPaymentId,
        providerSubscriptionId: ev.providerSubscriptionId,
        packageSnapshot: snap as unknown as Prisma.InputJsonValue,
        accessToken: randomToken(24),
        idempotencyKey: `renew:${provider}:${ev.providerPaymentId}`,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return; // already processed
    throw e;
  }
  try {
    await db.transaction.create({ data: { resellerId, orderId: order.id, subscriptionId: sub.id, type: "PAYMENT", status: "SUCCEEDED", amountCents: ev.amountMinor, currency: ev.currency, provider, providerRef: ev.providerPaymentId } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  await createInvoice(order.id);
  await enqueueActivation(order.id).catch(() => {});
}

async function onFailed(resellerId: string, provider: PaymentProvider, ev: Extract<PaymentEvent, { type: "payment.failed" }>) {
  const order = await findOrderForEvent(resellerId, provider, ev);
  if (order) {
    const res = await db.order.updateMany({ where: { id: order.id, status: "PENDING" }, data: { status: "FAILED", errorMessage: ev.reason } });
    if (res.count === 0) return;
    const [customer, reseller] = await Promise.all([db.customer.findUniqueOrThrow({ where: { id: order.customerId } }), db.reseller.findUniqueOrThrow({ where: { id: resellerId } })]);
    const snap = order.packageSnapshot as unknown as PackageSnapshot;
    await enqueueEmail({ resellerId, template: "payment_failed", to: customer.email, vars: { packageName: snap.name, reason: ev.reason, retryUrl: storeBaseUrl(reseller) } }).catch(() => {});
    return;
  }
  if (ev.providerSubscriptionId) {
    const sub = await db.subscription.findFirst({ where: { resellerId, provider, providerSubscriptionId: ev.providerSubscriptionId }, include: { customer: true, package: true, reseller: true } });
    if (sub) {
      await enqueueEmail({ resellerId, template: "payment_failed", to: sub.customer.email, vars: { packageName: sub.package.name, reason: ev.reason, retryUrl: `${storeBaseUrl(sub.reseller)}/portal` } }).catch(() => {});
    }
  }
}

async function onRefund(resellerId: string, provider: PaymentProvider, ev: Extract<PaymentEvent, { type: "refund" }>) {
  const order = await db.order.findFirst({ where: { resellerId, provider, providerPaymentId: ev.providerPaymentId } });
  if (!order) return;
  try {
    await db.transaction.create({ data: { resellerId, orderId: order.id, subscriptionId: order.subscriptionId, type: "REFUND", status: "SUCCEEDED", amountCents: -(ev.amountMinor ?? order.amountCents), currency: order.currency, provider, providerRef: ev.refundId } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  if ((ev.amountMinor ?? order.amountCents) >= order.amountCents) await db.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
  await audit({ resellerId, action: "payment.refunded", target: order.id, meta: { amount: ev.amountMinor } });
}

/**
 * Applies verified provider events. Each event id is recorded once per (provider, reseller);
 * replays are ignored, so webhook retries can never double-activate or double-count.
 */
export async function handlePaymentEvents(resellerId: string, provider: PaymentProvider, events: PaymentEvent[]): Promise<void> {
  for (const ev of events) {
    let rec;
    try {
      rec = await db.webhookEvent.create({ data: { provider, scope: resellerId, eventId: ev.eventId, type: ev.type } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prev = await db.webhookEvent.findUnique({ where: { provider_scope_eventId: { provider, scope: resellerId, eventId: ev.eventId } } });
      if (prev?.processedAt) continue; // already handled
      rec = prev!;
    }
    try {
      switch (ev.type) {
        case "payment.succeeded":
          await onPaid(resellerId, provider, ev);
          break;
        case "subscription.renewed":
          await onRenewed(resellerId, provider, ev);
          break;
        case "payment.failed":
          await onFailed(resellerId, provider, ev);
          break;
        case "refund":
          await onRefund(resellerId, provider, ev);
          break;
        case "subscription.canceled":
          await db.subscription.updateMany({ where: { resellerId, provider, providerSubscriptionId: ev.providerSubscriptionId }, data: { autoRenew: false } });
          break;
        case "ignored":
          break;
      }
      await db.webhookEvent.update({ where: { id: rec.id }, data: { processedAt: new Date(), error: null } });
    } catch (e) {
      await db.webhookEvent.update({ where: { id: rec.id }, data: { error: String((e as Error).message).slice(0, 500) } });
      throw e;
    }
  }
}

export async function createInvoice(orderId: string): Promise<void> {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const snap = o.packageSnapshot as unknown as PackageSnapshot;
  const lines = [{ description: `${snap.name} — ${snap.durationDays} days${o.kind === "RENEWAL" ? " (renewal)" : ""}`, amount: o.amountCents + o.discountCents }];
  if (o.discountCents) lines.push({ description: "Discount", amount: -o.discountCents });
  try {
    await db.invoice.create({ data: { resellerId: o.resellerId, customerId: o.customerId, orderId: o.id, number: o.number.replace(/^(ORD|REN)/, "INV"), amountCents: o.amountCents, currency: o.currency, lines } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

/** Reseller-initiated refund through the provider; the provider's refund webhook is idempotent with this. */
export async function refundOrder(resellerId: string, orderId: string): Promise<void> {
  const order = await db.order.findFirst({ where: { id: orderId, resellerId } });
  if (!order || !order.providerPaymentId) throw new Error("Order cannot be refunded");
  if (order.status === "REFUNDED") return;
  const gw = await loadGateway(resellerId, order.provider);
  if (!gw) throw new Error("Payment gateway not configured");
  const r = await gw.impl.refund(gw.creds, order.providerPaymentId, order.amountCents, order.currency, gw.opts);
  await handlePaymentEvents(resellerId, order.provider, [{ type: "refund", eventId: `manual-refund:${r.refundId}`, providerPaymentId: order.providerPaymentId, amountMinor: order.amountCents, refundId: r.refundId }]);
}

export function revealPassword(enc: string | null): string | null {
  return enc ? decrypt(enc) : null;
}

export { encrypt };
export const orderStatusLabel: Record<string, string> = {
  PENDING: "Awaiting payment",
  PAID: "Paid — queued",
  ACTIVATING: "Activating",
  COMPLETED: "Completed",
  ACTIVATION_FAILED: "Activation failed",
  ON_HOLD: "On hold",
  CANCELED: "Canceled",
  FAILED: "Payment failed",
  REFUNDED: "Refunded",
};
export const appUrl = () => env.appUrl;
