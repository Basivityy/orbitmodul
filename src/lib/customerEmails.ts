import type { Reseller } from "@prisma/client";
import { streamServer } from "@/core/appApi";
import { decrypt } from "@/core/crypto";
import { addDays, formatEmailDate } from "@/core/dates";
import { emailSenderName } from "@/core/emailLayout";
import { formatMoney } from "@/core/money";
import { appIconUrl, getAppGuide, guideEmailBlocks } from "./appGuide";
import { db } from "./db";
import { storeBaseUrl } from "./urls";

type Contact = Pick<Reseller, "contactEmail" | "contactTelegram" | "contactWhatsapp" | "contactPhone">;

export function contactLine(r: Contact): string {
  return [r.contactEmail, r.contactTelegram && `Telegram ${r.contactTelegram}`, r.contactWhatsapp && `WhatsApp ${r.contactWhatsapp}`, r.contactPhone].filter(Boolean).join(" · ");
}

const MAXPLAYER_NOTE = "Your MaxPlayer app account uses the same username and password.";
const MAXPLAYER_NOTE_BHS = "U aplikaciji MaxPlayer prijavljujete se istim usernameom i lozinkom.";

/**
 * Everything for the "Login details" email of a subscription: recipient, template variables and the
 * app guide block. Passwords are decrypted here, right before sending, never stored in job payloads
 * longer than needed.
 */
export async function accessDetailsEmail(subscriptionId: string, opts: { packageName?: string; maxPlayerEnabled?: boolean; connections?: number } = {}) {
  const sub = await db.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    include: { customer: true, package: true, panel: true, reseller: { include: { maxPlayer: true } } },
  });
  const username = sub.lineUsername ?? "";
  const password = sub.linePasswordEnc ? decrypt(sub.linePasswordEnc) : "";
  const usesMaxPlayer = Boolean((opts.maxPlayerEnabled ?? sub.package.maxPlayerEnabled) && sub.reseller.maxPlayer?.enabled);
  const guide = await getAppGuide();
  return {
    to: sub.customer.email,
    vars: {
      packageName: opts.packageName ?? sub.package.name,
      username,
      password,
      serverUrl: streamServer(sub.panel),
      connections: String(opts.connections ?? sub.package.maxConnections),
      expiresAt: sub.expiresAt ? formatEmailDate(sub.expiresAt) : "",
      maxPlayerNote: usesMaxPlayer ? MAXPLAYER_NOTE : "",
      maxPlayerNoteBhs: usesMaxPlayer ? MAXPLAYER_NOTE_BHS : "",
      portalUrl: `${storeBaseUrl(sub.reseller)}/portal`,
      contact: contactLine(sub.reseller),
    },
    extra: guide.enabled && usesMaxPlayer && username ? guideEmailBlocks(guide, { username, password }, appIconUrl(guide)) : undefined,
  };
}

/**
 * Example values for the email editor's preview and "Send test email": the reseller's real store
 * name, contact, links, first package and panel address — with made-up login details.
 */
export async function sampleEmailVars(reseller: Reseller): Promise<Record<string, string>> {
  const [pkg, panel] = await Promise.all([
    db.package.findFirst({ where: { resellerId: reseller.id, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.panelIntegration.findFirst({ where: { resellerId: reseller.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ]);
  const base = storeBaseUrl(reseller);
  const expires = addDays(new Date(), pkg?.durationDays ?? 30);
  return {
    storeName: emailSenderName(reseller),
    packageName: pkg?.name ?? "1 Month",
    username: "demo4821",
    password: "Kp7xQ2mZ",
    serverUrl: panel ? streamServer(panel) : "http://line.example.com:80",
    connections: String(pkg?.maxConnections ?? 1),
    expiresAt: formatEmailDate(expires),
    maxPlayerNote: pkg?.maxPlayerEnabled ? MAXPLAYER_NOTE : "",
    maxPlayerNoteBhs: pkg?.maxPlayerEnabled ? MAXPLAYER_NOTE_BHS : "",
    portalUrl: `${base}/portal`,
    contact: contactLine(reseller) || emailSenderName(reseller),
    orderNumber: "ORD-100245",
    amount: formatMoney(pkg?.priceCents ?? 1000, pkg?.currency ?? reseller.defaultCurrency),
    daysLeft: "3",
    renewUrl: `${base}/renew`,
    reason: "card declined",
    retryUrl: base,
    loginUrl: `${base}/portal/verify?token=example`,
  };
}
