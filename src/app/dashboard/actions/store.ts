"use server";

import { resolveTxt } from "dns/promises";
import { randomToken } from "@/core/crypto";
import { getDefaultTemplate } from "@/core/emailTemplates";
import { isSupportedCurrency } from "@/core/money";
import { isValidEmail, isValidSlug, normalizeDomain } from "@/core/ids";
import { act, optStr, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { loadResellerSaas, planLimits } from "@/lib/saas";

function color(v: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

export async function saveStoreAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/store", async () => {
    const storeName = str(fd, "storeName", 80);
    if (!storeName) throw new UserError("Store name is required.");
    const slug = str(fd, "slug", 40).toLowerCase();
    if (slug !== reseller.slug) {
      if (!isValidSlug(slug)) throw new UserError("Invalid store address.");
      if (await db.reseller.findUnique({ where: { slug } })) throw new UserError("This store address is taken.");
    }
    const logoUrl = optStr(fd, "logoUrl", 500);
    if (logoUrl && !/^https:\/\/[^\s"'<>]+$/.test(logoUrl)) throw new UserError("Logo URL must be an https:// link to an image.");
    const contactEmail = optStr(fd, "contactEmail", 254);
    if (contactEmail && !isValidEmail(contactEmail)) throw new UserError("Invalid contact email.");
    const defaultCurrency = str(fd, "defaultCurrency", 3).toUpperCase();
    if (!isSupportedCurrency(defaultCurrency)) throw new UserError("Unsupported currency.");
    await db.reseller.update({
      where: { id: reseller.id },
      data: {
        storeName,
        slug,
        logoUrl,
        primaryColor: color(str(fd, "primaryColor", 7), reseller.primaryColor),
        accentColor: color(str(fd, "accentColor", 7), reseller.accentColor),
        description: optStr(fd, "description", 2000),
        contactEmail,
        contactPhone: optStr(fd, "contactPhone", 40),
        contactTelegram: optStr(fd, "contactTelegram", 60),
        contactWhatsapp: optStr(fd, "contactWhatsapp", 40),
        termsText: optStr(fd, "termsText", 20000),
        refundPolicy: optStr(fd, "refundPolicy", 20000),
        defaultCurrency,
        linePrefix: str(fd, "linePrefix", 8).replace(/[^a-zA-Z0-9]/g, "").toLowerCase(),
      },
    });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "store.updated", meta: { slugChanged: slug !== reseller.slug } });
    return "Store settings saved.";
  });
}

export async function setDomainAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/store#domain", async () => {
    if (str(fd, "op") === "remove") {
      await db.reseller.update({ where: { id: reseller.id }, data: { customDomain: null, customDomainVerified: false, domainVerifyToken: null } });
      await audit({ actor: actorOf(user), resellerId: reseller.id, action: "store.domain_removed" });
      return "Custom domain removed.";
    }
    if (!planLimits(await loadResellerSaas(reseller.id)).allowCustomDomain) throw new UserError("Custom domains are not included in your plan.");
    const domain = normalizeDomain(str(fd, "domain", 253));
    if (!domain) throw new UserError("Enter a valid domain, e.g. shop.example.com");
    if (domain === env.appHost.replace(/:\d+$/, "")) throw new UserError("That is the platform domain.");
    const taken = await db.reseller.findFirst({ where: { customDomain: domain, NOT: { id: reseller.id } } });
    if (taken) throw new UserError("This domain is already connected to another store.");
    await db.reseller.update({ where: { id: reseller.id }, data: { customDomain: domain, customDomainVerified: false, domainVerifyToken: `xb-${randomToken(12)}` } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "store.domain_set", target: domain });
    return "Domain saved. Add the DNS records below, then click Verify.";
  });
}

export async function verifyDomainAction() {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/store#domain", async () => {
    if (!reseller.customDomain || !reseller.domainVerifyToken) throw new UserError("Set a domain first.");
    let records: string[][] = [];
    try {
      records = await resolveTxt(`_xuibilling.${reseller.customDomain}`);
    } catch {
      throw new UserError(`No TXT record found at _xuibilling.${reseller.customDomain} yet. DNS changes can take a few minutes.`);
    }
    if (!records.some((r) => r.join("").trim() === reseller.domainVerifyToken)) throw new UserError("The TXT record does not match the verification code.");
    await db.reseller.update({ where: { id: reseller.id }, data: { customDomainVerified: true } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "store.domain_verified", target: reseller.customDomain });
    return "Domain verified — your store is live on it once the CNAME/proxy points to the platform.";
  });
}

/** Name customers see in every email: From name, the coloured header and the signature. */
export async function saveEmailSenderNameAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/emails", async () => {
    const name = str(fd, "emailFromName", 80).replace(/["<>\r\n]/g, "").replace(/\s+/g, " ").trim();
    await db.reseller.update({ where: { id: reseller.id }, data: { emailFromName: name || null } });
    // Keep the reseller's own mailbox (if any) on the same name.
    await db.resellerMail.updateMany({ where: { resellerId: reseller.id }, data: { fromName: name || null } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "email.sender_name_saved", meta: { name } });
    return name ? `Saved. Your emails now show “${name}”.` : `Saved. Your emails show your store name “${reseller.storeName}”.`;
  });
}

export async function saveEmailTemplateAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/emails", async () => {
    const key = str(fd, "key", 60);
    const def = getDefaultTemplate(key);
    if (def.audience !== "customer") throw new UserError("This template cannot be customized.");
    if (str(fd, "op") === "reset") {
      await db.emailTemplate.deleteMany({ where: { resellerId: reseller.id, key } });
      return `“${def.label}” reset to default.`;
    }
    const subject = str(fd, "subject", 200);
    const body = str(fd, "body", 10000);
    if (!subject || !body) throw new UserError("Subject and body are required.");
    const existing = await db.emailTemplate.findFirst({ where: { resellerId: reseller.id, key } });
    if (existing) await db.emailTemplate.update({ where: { id: existing.id }, data: { subject, body } });
    else await db.emailTemplate.create({ data: { resellerId: reseller.id, key, subject, body } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "email_template.saved", target: key });
    return `“${def.label}” saved.`;
  });
}
