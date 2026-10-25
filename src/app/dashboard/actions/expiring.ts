"use server";

import { daysUntil, formatEmailDate } from "@/core/dates";
import { normalizePhone } from "@/core/engage";
import { isPlaceholderEmail } from "@/core/importedCustomers";
import { act, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { expiringWhere, parseExpiringTab } from "@/lib/expiring";
import { enqueueEmail } from "@/lib/queue";
import { rateLimit } from "@/lib/ratelimit";
import { storeBaseUrl } from "@/lib/urls";

const back = (fd: FormData) => {
  const b = str(fd, "back", 300);
  return b.startsWith("/dashboard/expiring") ? b : "/dashboard/expiring";
};

type Sub = { id: string; expiresAt: Date | null; customer: { email: string }; package: { name: string } };

async function sendReminder(resellerId: string, renewUrl: string, s: Sub): Promise<boolean> {
  if (!s.expiresAt || s.expiresAt <= new Date() || isPlaceholderEmail(s.customer.email)) return false;
  await enqueueEmail({ resellerId, template: "subscription_expiring", to: s.customer.email, vars: { packageName: s.package.name, expiresAt: formatEmailDate(s.expiresAt), daysLeft: String(Math.max(daysUntil(s.expiresAt), 1)), renewUrl } });
  await db.subscription.update({ where: { id: s.id }, data: { reminderSentAt: new Date() } });
  return true;
}

export async function sendReminderAction(fd: FormData) {
  return act(back(fd), async () => {
    const { reseller } = await requireReseller();
    const s = await db.subscription.findFirst({ where: { id: str(fd, "id", 40), resellerId: reseller.id }, include: { customer: true, package: true } });
    if (!s) throw new UserError("Line not found.");
    if (!(await rateLimit(`remind:${reseller.id}`, 200, 3600))) throw new UserError("Too many reminders this hour.");
    if (!(await sendReminder(reseller.id, `${storeBaseUrl(reseller)}/renew`, s))) throw new UserError("This customer has no email address (or the line already expired) — use WhatsApp / Viber / Copy instead.");
    return `Reminder emailed to ${s.customer.email}.`;
  });
}

export async function sendRemindersBulkAction(fd: FormData) {
  return act(back(fd), async () => {
    const { user, reseller } = await requireReseller();
    const tab = parseExpiringTab(str(fd, "tab", 10));
    if (tab === "expired") throw new UserError("Expired lines get no email reminder — use WhatsApp / Viber.");
    if (!(await rateLimit(`remind-bulk:${reseller.id}`, 3, 3600))) throw new UserError("You can send the bulk reminder at most 3 times per hour.");
    const subs = await db.subscription.findMany({ where: { ...expiringWhere(reseller.id, tab), OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: new Date(Date.now() - 24 * 3600_000) } }] }, include: { customer: true, package: true }, take: 2000 });
    const url = `${storeBaseUrl(reseller)}/renew`;
    let sent = 0;
    for (const s of subs) if (await sendReminder(reseller.id, url, s)) sent++;
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "reminders.bulk_sent", meta: { tab, sent } });
    const skipped = subs.length - sent;
    return `${sent} reminder email(s) queued.${skipped ? ` ${skipped} have no email address — use WhatsApp / Viber for them.` : ""} Lines reminded in the last 24 hours were skipped.`;
  });
}

export async function setCustomerPhoneAction(fd: FormData) {
  return act(back(fd), async () => {
    const { reseller } = await requireReseller();
    const raw = str(fd, "phone", 40);
    const phone = raw ? normalizePhone(raw, str(fd, "cc", 4) || "387") : null;
    if (raw && !phone) throw new UserError("Enter the phone number with the country code, e.g. +387 61 234 567.");
    const c = await db.customer.updateMany({ where: { id: str(fd, "customerId", 40), resellerId: reseller.id }, data: { phone } });
    if (!c.count) throw new UserError("Customer not found.");
    return phone ? `Phone saved: +${phone}` : "Phone removed.";
  });
}
