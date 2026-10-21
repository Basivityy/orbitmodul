"use server";

import type { Prisma } from "@prisma/client";
import { decrypt, randomToken } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { orderNumber } from "@/core/ids";
import { parseAmountToMinor } from "@/core/money";
import { getProvider } from "@/core/payments";
import { TestProvider } from "@/core/payments/test";
import { act, int, str, UserError } from "@/lib/action";
import { effectiveTestMode } from "@/lib/activationStore";
import { apiLogger, audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadGateway } from "@/lib/gateways";
import { createInvoice, handlePaymentEvents, refundOrder, snapshotPackage, startCheckout } from "@/lib/orders";
import { enqueueActivation, enqueueEmail } from "@/lib/queue";
import { accessDetailsEmail } from "@/lib/customerEmails";

function safeBack(fd: FormData, fallback: string): string {
  const b = str(fd, "back", 300);
  return b.startsWith("/dashboard") ? b : fallback;
}

export async function retryActivationAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "orderId", 40);
  return act(safeBack(fd, "/dashboard/orders"), async () => {
    const o = await db.order.findFirst({ where: { id, resellerId: reseller.id } });
    if (!o) throw new UserError("Order not found.");
    if (!["ACTIVATION_FAILED", "ON_HOLD", "PAID", "ACTIVATING"].includes(o.status)) throw new UserError("Only paid orders that are not yet activated can be retried.");
    await db.order.update({ where: { id }, data: { lockedUntil: null, errorMessage: null } });
    await enqueueActivation(id, { retry: true });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "order.activation_retry", target: id });
    return "Activation queued. Refresh in a few seconds.";
  });
}

export async function refundOrderAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "orderId", 40);
  return act(safeBack(fd, "/dashboard/orders"), async () => {
    await refundOrder(reseller.id, id);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "order.refund", target: id });
    return "Refund issued. The customer's line was not changed — disable it from the subscription if needed.";
  });
}

/** Starts a test purchase through the built-in TEST gateway (dashboard only). */
export async function testPurchaseAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const packageId = str(fd, "packageId", 40);
  return act(`/dashboard/packages/${packageId}`, async () => {
    const gw = await loadGateway(reseller.id, "TEST");
    if (!gw || !gw.row.enabled) throw new UserError("Enable the Test gateway on the Payment gateways page first.");
    const email = str(fd, "email", 254).toLowerCase() || user.email;
    const { order } = await startCheckout({ resellerId: reseller.id, packageId, email, provider: "TEST", lineUsername: `test${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, idempotencyKey: `test-${randomToken(12)}`, siteBase: `${env.appUrl}/store/${reseller.slug}` });
    return { redirect: `/dashboard/test-pay/${order.id}` };
  });
}

export async function completeTestPaymentAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "orderId", 40);
  return act(`/dashboard/test-pay/${id}`, async () => {
    const o = await db.order.findFirst({ where: { id, resellerId: reseller.id, provider: "TEST" } });
    if (!o) throw new UserError("Test order not found.");
    if (str(fd, "outcome") === "fail") {
      await handlePaymentEvents(reseller.id, "TEST", [{ type: "payment.failed", eventId: `test-fail:${o.id}`, orderId: o.id, reason: "Simulated failure" }]);
      return "Simulated a failed payment.";
    }
    await handlePaymentEvents(reseller.id, "TEST", [TestProvider.paidEvent(o.id, o.amountCents, o.currency)]);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "order.test_paid", target: o.id });
    return { redirect: `/dashboard/orders/${o.id}`, message: "Test payment confirmed — activation is running." };
  });
}

async function ownedSub(resellerId: string, id: string) {
  const s = await db.subscription.findFirst({ where: { id, resellerId }, include: { panel: true, customer: true, package: true } });
  if (!s) throw new UserError("Subscription not found.");
  return s;
}

export async function setLineStateAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  const enable = str(fd, "op") === "enable";
  return act(`/dashboard/subscriptions/${id}`, async () => {
    const s = await ownedSub(reseller.id, id);
    if (!s.xuiLineId) throw new UserError("This subscription has no line yet.");
    const adapter = createPanelAdapter(s.panel.type, { apiUrl: s.panel.apiUrl, apiKey: decrypt(s.panel.apiKeyEnc) }, { testMode: effectiveTestMode(s.panel.testMode) || s.isTest, log: apiLogger(reseller.id, "XUI") });
    if (enable) await adapter.enableLine(s.xuiLineId);
    else await adapter.disableLine(s.xuiLineId);
    await db.subscription.update({ where: { id }, data: { status: enable ? (s.expiresAt && s.expiresAt > new Date() ? "ACTIVE" : "EXPIRED") : "SUSPENDED" } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: enable ? "line.enabled" : "line.disabled", target: id });
    return enable ? "Line enabled on the panel." : "Line disabled on the panel.";
  });
}

export async function syncLineAction(fd: FormData) {
  const { reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(`/dashboard/subscriptions/${id}`, async () => {
    const s = await ownedSub(reseller.id, id);
    if (!s.xuiLineId || s.isTest) throw new UserError("Nothing to sync for this subscription.");
    const adapter = createPanelAdapter(s.panel.type, { apiUrl: s.panel.apiUrl, apiKey: decrypt(s.panel.apiKeyEnc) }, { testMode: false, log: apiLogger(reseller.id, "XUI") });
    const line = await adapter.getLine(s.xuiLineId);
    if (!line) throw new UserError("The line was not found on the panel (deleted?).");
    return `Panel status: ${line.enabled === false ? "disabled" : "enabled"}, expires ${line.expiresAt ? line.expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never/unknown"}.`;
  });
}

export async function extendSubscriptionAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(`/dashboard/subscriptions/${id}`, async () => {
    const s = await ownedSub(reseller.id, id);
    const amountRaw = str(fd, "amount", 20);
    const amount = amountRaw ? parseAmountToMinor(amountRaw, s.currency) : 0;
    if (amount === null) throw new UserError("Enter a valid amount, e.g. 10 or 9.99.");
    // Reseller API: lines are extended with a panel package (its duration), not a number of days.
    const resellerApi = /reseller/i.test(s.panel.apiUrl);
    const chosen = str(fd, "packageId", 40);
    let pkgId = s.packageId;
    if (chosen) {
      const p = await db.package.findFirst({ where: { id: chosen, resellerId: reseller.id, panelId: s.panelId } });
      if (!p) throw new UserError("Select a package of this panel.");
      pkgId = p.id;
    }
    const snap = await snapshotPackage(pkgId, reseller.id, amount, s.currency);
    if (resellerApi) {
      if (!snap.panelPackageId) throw new UserError("Choose a package that is linked to a panel package (Packages & prices → Panel package).");
    } else {
      snap.durationDays = int(fd, "days", { min: 1, max: 3650 });
    }
    const o = await db.order.create({
      data: {
        number: orderNumber("REN"),
        resellerId: reseller.id,
        customerId: s.customerId,
        packageId: pkgId,
        subscriptionId: s.id,
        kind: "RENEWAL",
        status: "PAID",
        paidAt: new Date(),
        amountCents: amount,
        currency: s.currency,
        provider: "MANUAL",
        providerPaymentId: `manual-${randomToken(10)}`,
        packageSnapshot: snap as unknown as Prisma.InputJsonValue,
        accessToken: randomToken(24),
        idempotencyKey: `manual-${randomToken(12)}`,
        errorMessage: null,
      },
    });
    if (amount > 0) {
      await db.transaction.create({ data: { resellerId: reseller.id, orderId: o.id, subscriptionId: s.id, type: "PAYMENT", status: "SUCCEEDED", amountCents: amount, currency: s.currency, provider: "MANUAL", providerRef: o.providerPaymentId } });
    }
    await createInvoice(o.id);
    await enqueueActivation(o.id);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "subscription.manual_extend", target: id, meta: { days: snap.durationDays, package: snap.name, amount } });
    return `Extension by ${snap.durationDays} day(s)${resellerApi ? ` (${snap.name})` : ""} queued${amount ? " and the payment was recorded" : ""}.`;
  });
}

export async function cancelAutoRenewAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(`/dashboard/subscriptions/${id}`, async () => {
    const s = await ownedSub(reseller.id, id);
    if (!s.autoRenew || !s.providerSubscriptionId || !s.provider) throw new UserError("This subscription does not renew automatically.");
    const gw = await loadGateway(reseller.id, s.provider);
    const impl = getProvider(s.provider);
    if (!gw || !impl.cancelSubscription) throw new UserError("The payment gateway cannot cancel this subscription.");
    await impl.cancelSubscription(gw.creds, s.providerSubscriptionId, gw.opts);
    await db.subscription.update({ where: { id }, data: { autoRenew: false } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "subscription.autorenew_canceled", target: id });
    return "Automatic renewal canceled. The subscription stays active until it expires.";
  });
}

export async function resendCredentialsAction(fd: FormData) {
  const { reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(`/dashboard/subscriptions/${id}`, async () => {
    const s = await ownedSub(reseller.id, id);
    if (!s.lineUsername || !s.linePasswordEnc || !s.expiresAt) throw new UserError("No credentials yet.");
    // Note: credentials travel through the email queue here (explicit resend by the reseller).
    const mail = await accessDetailsEmail(s.id);
    await enqueueEmail({ resellerId: reseller.id, template: "subscription_activated", to: s.customer.email, vars: mail.vars, extra: mail.extra });
    return `Access details sent to ${s.customer.email}.`;
  });
}
