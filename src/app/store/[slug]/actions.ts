"use server";

import type { PaymentProvider } from "@prisma/client";
import { isValidEmail } from "@/core/ids";
import { getProvider } from "@/core/payments";
import { act, bool, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { consumeToken, createCustomerSession, destroyCustomerSession, getCurrentCustomer, issueToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadGateway } from "@/lib/gateways";
import { CheckoutError, startCheckout } from "@/lib/orders";
import { enqueueEmail } from "@/lib/queue";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { resolveStore } from "@/lib/storefront";
import { normalizeCode } from "@/core/codes";
import { maskUsername } from "@/core/usernames";
import { claimCode, redeemCode } from "@/lib/codes";
import { findActivationDevice, pickLang, t, translateError } from "@/core/i18n/codeFlow";
import { storeTestPaymentsEnabled } from "@/lib/settings";
import { TestProvider } from "@/core/payments/test";
import { handlePaymentEvents } from "@/lib/orders";
import { makeRenewToken, verifyRenewToken } from "@/core/renewToken";
import { findLineForRenewal } from "@/lib/lineImport";

export async function checkoutAction(fd: FormData) {
  const slug = str(fd, "slug", 300);
  const packageId = str(fd, "packageId", 40);
  const store = await resolveStore(slug);
  const renew = str(fd, "renew", 40);
  const line = str(fd, "line", 40);
  const lineToken = str(fd, "t", 120);
  const back = `${store.base}/checkout/${packageId}${renew ? `?renew=${renew}` : line ? `?line=${line}&t=${encodeURIComponent(lineToken)}` : ""}`;
  return act(back || "/", async () => {
    if (!store.canSell) throw new UserError("This store is not accepting orders right now.");
    const ip = await clientIp();
    if (!(await rateLimit(`checkout:${ip}`, 15, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    if (!bool(fd, "terms")) throw new UserError("Please accept the terms to continue.");
    const provider = str(fd, "provider", 20) as PaymentProvider;
    const storeTestPayment = provider === "TEST" && (await storeTestPaymentsEnabled());
    if (provider === "TEST" && !storeTestPayment) throw new UserError("This payment method is not available.");
    let email = str(fd, "email", 254).toLowerCase();
    let renewSubscriptionId: string | undefined;
    let renewByLine = false;
    if (line) {
      // Existing customer who identified by line username (signed, short-lived link).
      if (!verifyRenewToken(line, lineToken)) throw new UserError("This renewal link has expired. Please enter your username again.");
      renewSubscriptionId = line;
      renewByLine = true;
    } else if (renew) {
      const customer = await getCurrentCustomer(store.reseller.id);
      if (!customer) throw new UserError("Please sign in to the customer portal to renew.");
      email = customer.email;
      renewSubscriptionId = renew;
    }
    if (!isValidEmail(email)) throw new UserError("Enter a valid email address.");
    try {
      const { redirectUrl } = await startCheckout({
        resellerId: store.reseller.id,
        packageId,
        email,
        name: str(fd, "name", 100) || undefined,
        provider,
        couponCode: str(fd, "coupon", 30) || undefined,
        renewSubscriptionId,
        renewByLine,
        storeTestPayment,
        lineUsername: renewSubscriptionId ? undefined : str(fd, "lineUsername", 40).trim(),
        idempotencyKey: `co-${str(fd, "idem", 64)}`,
        siteBase: store.absoluteBase,
      });
      return { redirect: redirectUrl };
    } catch (e) {
      if (e instanceof CheckoutError) throw new UserError(e.message);
      throw e;
    }
  });
}

export async function portalLoginAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  return act(`${store.base}/portal`, async () => {
    const email = str(fd, "email", 254).toLowerCase();
    const ip = await clientIp();
    if (!(await rateLimit(`portal:${ip}`, 10, 900)) || !(await rateLimit(`portal:${email}`, 4, 900))) throw new UserError("Too many requests. Please wait a few minutes.");
    if (!isValidEmail(email)) throw new UserError("Enter a valid email address.");
    const customer = await db.customer.findUnique({ where: { resellerId_email: { resellerId: store.reseller.id, email } } });
    if (customer) {
      const token = await issueToken("CUSTOMER_LOGIN", { customerId: customer.id }, 30);
      await enqueueEmail({ resellerId: store.reseller.id, template: "customer_login", to: email, vars: { loginUrl: `${store.absoluteBase}/portal/verify?token=${token}` } });
    }
    return "If this email has purchases in this store, a sign-in link has been sent. Check your inbox.";
  });
}

export async function portalVerifyAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  return act(`${store.base}/portal`, async () => {
    const t = await consumeToken("CUSTOMER_LOGIN", str(fd, "token", 200));
    if (!t?.customerId) throw new UserError("This sign-in link is invalid or has expired. Request a new one.");
    const c = await db.customer.findFirst({ where: { id: t.customerId, resellerId: store.reseller.id } });
    if (!c) throw new UserError("This sign-in link is not valid for this store.");
    await createCustomerSession(c.id);
    return { redirect: `${store.base}/portal` };
  });
}

export async function portalLogoutAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  await destroyCustomerSession();
  return act(`${store.base}/portal`, async () => "You have been signed out.");
}

export async function portalCancelAutoRenewAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  return act(`${store.base}/portal`, async () => {
    const customer = await getCurrentCustomer(store.reseller.id);
    if (!customer) throw new UserError("Please sign in.");
    const s = await db.subscription.findFirst({ where: { id: str(fd, "subscriptionId", 40), customerId: customer.id, resellerId: store.reseller.id } });
    if (!s || !s.autoRenew || !s.provider || !s.providerSubscriptionId) throw new UserError("This subscription does not renew automatically.");
    const gw = await loadGateway(store.reseller.id, s.provider);
    const impl = getProvider(s.provider);
    if (!gw || !impl.cancelSubscription) throw new UserError("Please contact the store to cancel.");
    await impl.cancelSubscription(gw.creds, s.providerSubscriptionId, gw.opts);
    await db.subscription.update({ where: { id: s.id }, data: { autoRenew: false } });
    await audit({ resellerId: store.reseller.id, action: "subscription.autorenew_canceled_by_customer", target: s.id });
    return "Automatic renewal canceled. Your subscription stays active until it expires.";
  });
}

/** "Already a customer?" — find the line(s) by email or by username and continue to the renewal options. */
export async function lookupLineAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  return act(`${store.base}/renew`, async () => {
    const ip = await clientIp();
    if (!(await rateLimit(`renew-lookup:${ip}`, 10, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    const value = str(fd, "account", 254).trim();
    if (value.includes("@")) {
      const email = value.toLowerCase();
      if (!isValidEmail(email)) throw new UserError("Enter a valid email address.");
      const customer = await db.customer.findUnique({ where: { resellerId_email: { resellerId: store.reseller.id, email } }, select: { id: true } });
      const lines = customer ? await db.subscription.count({ where: { customerId: customer.id, xuiLineId: { not: null } } }) : 0;
      if (!customer || !lines) throw new UserError("We found no line for this email. Try your username, or contact us.");
      return { redirect: `${store.base}/renew?c=${customer.id}&t=${encodeURIComponent(makeRenewToken(`cust:${customer.id}`))}` };
    }
    if (!/^[A-Za-z0-9_.-]{2,60}$/.test(value)) throw new UserError("Enter your email or your username exactly as you use it in the app.");
    const sub = await findLineForRenewal(store.reseller.id, value);
    if (!sub) throw new UserError("We could not find this username. Check the spelling (it is case-sensitive), try your email, or contact us.");
    return { redirect: `${store.base}/renew?line=${sub.id}&t=${encodeURIComponent(makeRenewToken(sub.id))}` };
  });
}

/** Store test mode: the customer "pays" on a simulated payment page. */
export async function storeTestPayAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  const token = str(fd, "token", 80);
  return act(`${store.base}/test-pay/${token}`, async () => {
    if (!(await storeTestPaymentsEnabled())) throw new UserError("Test payments are turned off.");
    const o = await db.order.findFirst({ where: { accessToken: token, resellerId: store.reseller.id, provider: "TEST" } });
    if (!o) throw new UserError("Order not found.");
    if (o.status !== "PENDING") return { redirect: `${store.base}/order/${o.accessToken}` };
    if (str(fd, "outcome") === "fail") {
      await handlePaymentEvents(store.reseller.id, "TEST", [{ type: "payment.failed", eventId: `test-fail:${o.id}`, orderId: o.id, reason: "Simulated failure" }]);
    } else {
      await handlePaymentEvents(store.reseller.id, "TEST", [TestProvider.paidEvent(o.id, o.amountCents, o.currency)]);
      await audit({ resellerId: store.reseller.id, action: "order.store_test_paid", target: o.id });
    }
    return { redirect: `${store.base}/order/${o.accessToken}` };
  });
}

/** Arrival from the selling site: save the email and mail the activation link before anything else. */
export async function claimCodeAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  const rawCode = str(fd, "code", 40);
  const lang = pickLang(str(fd, "lang", 5));
  return act(`${store.base}/activate?code=${encodeURIComponent(rawCode)}&lang=${lang}&change=1`, async () => {
    try {
      if (!store.canSell) throw new UserError("This store is not active right now. Please contact the store.");
      const ip = await clientIp();
      if (!(await rateLimit(`claim:${ip}`, 10, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
      const code = normalizeCode(rawCode);
      if (!code) throw new UserError("Enter the 12-character code, e.g. A7K2-9QXM-4TPL.");
      const email = str(fd, "email", 254).trim().toLowerCase();
      if (!isValidEmail(email)) throw new UserError("Enter your email address — we send you this link there.");
      if (!(await rateLimit(`claim-code:${code}`, 6, 86_400))) throw new UserError("Too many attempts. Please wait a few minutes.");
      const activationUrl = `${store.absoluteBase}/activate?code=${encodeURIComponent(code)}&lang=${lang}`;
      try {
        await claimCode(store.reseller.id, { code, email, activationUrl });
      } catch (e) {
        if (e instanceof CheckoutError) throw new UserError(e.message);
        throw e;
      }
      return { redirect: `${store.base}/activate?code=${encodeURIComponent(code)}&lang=${lang}`, message: t(lang, "saved", { email }) };
    } catch (e) {
      if (e instanceof UserError) throw new UserError(translateError(lang, e.message));
      throw e;
    }
  });
}

/** Universal activation link: redeem a one-time code for a new line or an extension. */
export async function redeemCodeAction(fd: FormData) {
  const store = await resolveStore(str(fd, "slug", 300));
  const mode = str(fd, "mode") === "extend" ? "extend" : "new";
  const rawCode = str(fd, "code", 40);
  const lang = pickLang(str(fd, "lang", 5));
  const device = findActivationDevice(str(fd, "device", 20));
  return act(`${store.base}/activate?code=${encodeURIComponent(rawCode)}&mode=${mode}&lang=${lang}${device ? `&device=${device.key}` : ""}`, async () => {
   try {
    if (!store.canSell) throw new UserError("This store is not active right now. Please contact the store.");
    // Devices without self-activation (Hisense/VIDAA) go to support instead.
    if (device?.blocked) return { redirect: `${store.base}/activate?code=${encodeURIComponent(rawCode)}&lang=${lang}&device=${device.key}` };
    const ip = await clientIp();
    if (!(await rateLimit(`redeem:${ip}`, 15, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    const code = normalizeCode(rawCode);
    if (!code) throw new UserError("Enter the 12-character code, e.g. A7K2-9QXM-4TPL.");
    try {
      if (mode === "new") {
        const email = str(fd, "email", 254).trim().toLowerCase();
        if (!isValidEmail(email)) throw new UserError("Enter a valid email address — your access details are sent there.");
        const r = await redeemCode(store.reseller.id, { mode: "new", code, email, username: str(fd, "lineUsername", 40).trim(), device: device?.en });
        return { redirect: `${store.base}/order/${r.accessToken}?lang=${lang}` };
      }
      const account = str(fd, "account", 254).trim();
      let subscriptionId: string | null = null;
      if (account.includes("@")) {
        const customer = await db.customer.findUnique({ where: { resellerId_email: { resellerId: store.reseller.id, email: account.toLowerCase() } }, select: { id: true } });
        const lines = customer ? await db.subscription.findMany({ where: { customerId: customer.id, xuiLineId: { not: null } }, select: { id: true, lineUsername: true } }) : [];
        if (lines.length === 0) throw new UserError("We found no line for this email. Enter your username instead, or contact the store.");
        if (lines.length > 1) throw new UserError(`You have ${lines.length} lines (${lines.map((l) => maskUsername(l.lineUsername ?? "")).join(", ")}). Enter the username of the line you want to extend.`);
        subscriptionId = lines[0].id;
      } else {
        if (!/^[A-Za-z0-9_.-]{2,60}$/.test(account)) throw new UserError("Enter your username (as in the app) or your email.");
        const sub = await findLineForRenewal(store.reseller.id, account);
        if (!sub) throw new UserError("We could not find this username. If your line was bought before, ask the store to add it — then try again.");
        subscriptionId = sub.id;
      }
      const given = str(fd, "email", 254).trim().toLowerCase();
      const r = await redeemCode(store.reseller.id, { mode: "extend", code, subscriptionId, email: isValidEmail(given) ? given : null });
      return { redirect: `${store.base}/order/${r.accessToken}?lang=${lang}` };
    } catch (e) {
      if (e instanceof CheckoutError) throw new UserError(e.message);
      throw e;
    }
   } catch (e) {
    // Same messages in the customer's language (BHS / EN / DE).
    if (e instanceof UserError) throw new UserError(translateError(lang, e.message));
    throw e;
   }
  });
}
