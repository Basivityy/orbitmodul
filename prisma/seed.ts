/**
 * Idempotent seed — safe to run on every deploy.
 *  - default SaaS plans (STARTER / PRO / BUSINESS) if none exist
 *  - the Super Admin from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
 *  - optionally the platform owner's own reseller store with the initial XUI One and
 *    MaxPlayer API credentials from env (INITIAL_*). Keys are stored encrypted, in test mode.
 */
import { PrismaClient } from "@prisma/client";
import { encrypt, randomToken } from "../src/core/crypto";
import { hashPassword, passwordPolicyError } from "../src/core/password";

const db = new PrismaClient();

async function main() {
  if ((await db.saasPlan.count()) === 0) {
    await db.saasPlan.createMany({
      data: [
        { code: "STARTER", name: "Starter", priceCents: 900, currency: "EUR", maxPackages: 5, maxPanels: 1, maxActiveCustomers: 100, allowMaxPlayer: false, allowCustomDomain: false, isDefault: true, sortOrder: 1, features: ["Stripe, PayPal, Mollie, NOWPayments", "Automatic activation"] },
        { code: "PRO", name: "Pro", priceCents: 2900, currency: "EUR", maxPackages: 25, maxPanels: 2, maxActiveCustomers: 1000, allowMaxPlayer: true, allowCustomDomain: true, sortOrder: 2, features: ["Everything in Starter", "Priority support"] },
        { code: "BUSINESS", name: "Business", priceCents: 7900, currency: "EUR", maxPackages: 1000, maxPanels: 10, maxActiveCustomers: 100000, allowMaxPlayer: true, allowCustomDomain: true, sortOrder: 3, features: ["Everything in Pro", "Multiple panels"] },
      ],
    });
    console.log("✓ default plans created");
  }

  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (email && password) {
    const existing = await db.user.findUnique({ where: { email } });
    if (!existing) {
      const err = passwordPolicyError(password);
      if (err) throw new Error(`SUPER_ADMIN_PASSWORD: ${err}`);
      await db.user.create({ data: { email, name: "Super Admin", passwordHash: await hashPassword(password), role: "SUPER_ADMIN", emailVerifiedAt: new Date() } });
      console.log(`✓ super admin ${email} created — sign in and enable 2FA`);
    } else {
      console.log(`• super admin ${email} already exists (password unchanged)`);
    }
  } else {
    console.log("• SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — no super admin created");
  }

  // Platform owner's own store with the initial integration credentials.
  const ownerEmail = process.env.OWNER_RESELLER_EMAIL?.toLowerCase();
  const ownerPassword = process.env.OWNER_RESELLER_PASSWORD;
  if (ownerEmail && ownerPassword && !(await db.user.findUnique({ where: { email: ownerEmail } }))) {
    const err = passwordPolicyError(ownerPassword);
    if (err) throw new Error(`OWNER_RESELLER_PASSWORD: ${err}`);
    const plan = (await db.saasPlan.findFirst({ where: { code: "BUSINESS" } })) ?? (await db.saasPlan.findFirstOrThrow());
    const user = await db.user.create({
      data: {
        email: ownerEmail,
        name: "Platform owner",
        passwordHash: await hashPassword(ownerPassword),
        role: "RESELLER",
        emailVerifiedAt: new Date(),
        reseller: { create: { slug: process.env.OWNER_STORE_SLUG || "main", storeName: process.env.OWNER_STORE_NAME || "Main store", contactEmail: ownerEmail } },
      },
      include: { reseller: true },
    });
    const resellerId = user.reseller!.id;
    await db.saasSubscription.create({ data: { resellerId, planId: plan.id, status: "ACTIVE", currentPeriodEnd: new Date("2099-12-31") } });
    if (process.env.INITIAL_XUI_API_URL && process.env.INITIAL_XUI_API_KEY) {
      await db.panelIntegration.create({
        data: { resellerId, name: "Main XUI One panel", apiUrl: process.env.INITIAL_XUI_API_URL, apiKeyEnc: encrypt(process.env.INITIAL_XUI_API_KEY), testMode: true, isDefault: true },
      });
      console.log("✓ initial XUI One panel added (test mode)");
    }
    if (process.env.INITIAL_MAXPLAYER_API_KEY) {
      await db.maxPlayerIntegration.create({ data: { resellerId, apiKeyEnc: encrypt(process.env.INITIAL_MAXPLAYER_API_KEY), enabled: false, testMode: true } });
      console.log("✓ initial MaxPlayer key added (disabled, test mode — pick a domain in the dashboard)");
    }
    await db.paymentGateway.create({ data: { resellerId, provider: "TEST", credentialsEnc: encrypt("{}"), enabled: true, webhookToken: randomToken(24) } });
    console.log(`✓ owner store created: ${ownerEmail} → /store/${user.reseller!.slug}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
