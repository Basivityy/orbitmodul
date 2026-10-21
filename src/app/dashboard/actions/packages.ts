"use server";

import { isSupportedCurrency, parseAmountToMinor } from "@/core/money";
import { act, bool, int, optStr, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadResellerSaas, planLimits } from "@/lib/saas";

/**
 * Each reseller sets their own prices. Changing a package price affects new purchases and
 * manual renewals only — orders store a price snapshot, and auto-renewing (Stripe)
 * subscriptions keep the contracted price they started with.
 */
export async function savePackageAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act(id ? `/dashboard/packages/${id}` : "/dashboard/packages/new", async () => {
    const name = str(fd, "name", 80);
    if (!name) throw new UserError("Package name is required.");
    const currency = str(fd, "currency", 3).toUpperCase();
    if (!isSupportedCurrency(currency)) throw new UserError("Unsupported currency.");
    const priceCents = parseAmountToMinor(str(fd, "price", 20), currency);
    if (priceCents === null) throw new UserError("Enter a valid price, e.g. 10 or 9.99.");
    const promoRaw = str(fd, "promoPrice", 20);
    const promoPriceCents = promoRaw ? parseAmountToMinor(promoRaw, currency) : null;
    if (promoRaw && promoPriceCents === null) throw new UserError("Enter a valid promotional price.");
    if (promoPriceCents !== null && promoPriceCents >= priceCents) throw new UserError("The promotional price must be lower than the regular price.");
    const promoEndsRaw = str(fd, "promoEndsAt", 30);
    const promoEndsAt = promoEndsRaw ? new Date(promoEndsRaw) : null;
    if (promoEndsAt && isNaN(promoEndsAt.getTime())) throw new UserError("Invalid promotion end date.");
    const durationDays = int(fd, "durationDays", { min: 1, max: 3650 });
    const maxConnections = int(fd, "maxConnections", { min: 1, max: 100 });
    const billingType = str(fd, "billingType") === "RECURRING" ? "RECURRING" : "ONE_TIME";
    const panelId = str(fd, "panelId", 40);
    const panel = await db.panelIntegration.findFirst({ where: { id: panelId, resellerId: reseller.id } });
    if (!panel) throw new UserError("Select a connected XUI One panel.");
    const bouquetIds = fd.getAll("bouquets").map(String);
    const bouquets = await db.bouquet.findMany({ where: { id: { in: bouquetIds }, resellerId: reseller.id, panelId: panel.id } });
    if (bouquets.length !== bouquetIds.length) throw new UserError("Some selected bouquets do not belong to this panel. Re-sync bouquets and try again.");
    const externalPackageId = str(fd, "externalPackageId", 20) || null;
    if (externalPackageId && !/^\d{1,12}$/.test(externalPackageId)) throw new UserError("Invalid panel package.");
    if (bouquets.length === 0 && !externalPackageId) throw new UserError("Select at least one bouquet (or link a panel package).");
    const maxPlayerEnabled = bool(fd, "maxPlayerEnabled");
    if (maxPlayerEnabled && !planLimits(await loadResellerSaas(reseller.id)).allowMaxPlayer) throw new UserError("MaxPlayer integration is not included in your plan.");

    if (bool(fd, "active") && priceCents === 0) throw new UserError("Set a price above 0 before putting the package on sale. For free lines use “Add customer”.");
    const data = {
      name,
      description: optStr(fd, "description", 1000),
      panelId: panel.id,
      priceCents,
      currency,
      promoPriceCents,
      promoEndsAt: promoPriceCents !== null ? promoEndsAt : null,
      durationDays,
      maxConnections,
      billingType: billingType as "RECURRING" | "ONE_TIME",
      maxPlayerEnabled,
      isTrial: bool(fd, "isTrial"),
      active: bool(fd, "active"),
      sortOrder: int(fd, "sortOrder", { fallback: 0, min: -1000, max: 1000 }),
      externalPackageId,
    };

    let pkgId = id;
    if (id) {
      const existing = await db.package.findFirst({ where: { id, resellerId: reseller.id } });
      if (!existing) throw new UserError("Package not found.");
      await db.$transaction([
        db.package.update({ where: { id }, data }),
        db.packageBouquet.deleteMany({ where: { packageId: id } }),
        db.packageBouquet.createMany({ data: bouquets.map((b) => ({ packageId: id, bouquetId: b.id })) }),
      ]);
      await audit({ actor: actorOf(user), resellerId: reseller.id, action: "package.updated", target: id, meta: { priceBefore: existing.priceCents, priceAfter: priceCents, currency } });
    } else {
      const limits = planLimits(await loadResellerSaas(reseller.id));
      if ((await db.package.count({ where: { resellerId: reseller.id } })) >= limits.maxPackages) throw new UserError(`Your plan allows ${limits.maxPackages} packages. Upgrade to add more.`);
      const p = await db.package.create({ data: { ...data, resellerId: reseller.id, bouquets: { create: bouquets.map((b) => ({ bouquetId: b.id })) } } });
      pkgId = p.id;
      await audit({ actor: actorOf(user), resellerId: reseller.id, action: "package.created", target: p.id, meta: { priceCents, currency } });
    }
    return { redirect: `/dashboard/packages/${pkgId}`, message: "Package saved." };
  });
}

export async function togglePackageAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act("/dashboard/packages", async () => {
    const p = await db.package.findFirst({ where: { id, resellerId: reseller.id } });
    if (!p) throw new UserError("Package not found.");
    if (!p.active && p.priceCents === 0) throw new UserError(`Set a price for “${p.name}” first (open the package and enter your price).`);
    await db.package.update({ where: { id }, data: { active: !p.active } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: p.active ? "package.deactivated" : "package.activated", target: id });
    return p.active ? "Package hidden from your store." : "Package is now on sale.";
  });
}

export async function deletePackageAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act(`/dashboard/packages/${id}`, async () => {
    const p = await db.package.findFirst({ where: { id, resellerId: reseller.id }, include: { _count: { select: { orders: true, subscriptions: true, activationCodes: true } } } });
    if (!p) throw new UserError("Package not found.");
    if (p._count.orders || p._count.subscriptions) throw new UserError("This package has orders — deactivate it instead of deleting.");
    if (p._count.activationCodes) throw new UserError("This package has activation codes — deactivate it instead of deleting.");
    await db.package.delete({ where: { id } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "package.deleted", target: id });
    return { redirect: "/dashboard/packages", message: "Package deleted." };
  });
}

export async function saveCouponAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/coupons", async () => {
    const code = str(fd, "code", 30).toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new UserError("Code: 3–30 letters, numbers, - or _.");
    const type = str(fd, "type") === "FIXED" ? "FIXED" : "PERCENT";
    const currency = type === "FIXED" ? str(fd, "currency", 3).toUpperCase() : null;
    let value: number;
    if (type === "PERCENT") value = int(fd, "value", { min: 1, max: 100 });
    else {
      if (!currency || !isSupportedCurrency(currency)) throw new UserError("Select the coupon currency.");
      const v = parseAmountToMinor(str(fd, "value", 20), currency);
      if (!v) throw new UserError("Enter a valid discount amount.");
      value = v;
    }
    const until = str(fd, "validUntil", 30);
    const maxRaw = str(fd, "maxRedemptions", 10);
    const packageIds = fd.getAll("packageIds").map(String);
    if (packageIds.length) {
      const owned = await db.package.count({ where: { id: { in: packageIds }, resellerId: reseller.id } });
      if (owned !== packageIds.length) throw new UserError("Invalid package selection.");
    }
    if (await db.coupon.findUnique({ where: { resellerId_code: { resellerId: reseller.id, code } } })) throw new UserError("A coupon with this code already exists.");
    await db.coupon.create({
      data: {
        resellerId: reseller.id,
        code,
        type,
        value,
        currency,
        validUntil: until ? new Date(until) : null,
        maxRedemptions: maxRaw ? Math.max(1, parseInt(maxRaw, 10)) : null,
        packageIds,
      },
    });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "coupon.created", target: code });
    return `Coupon ${code} created.`;
  });
}

export async function toggleCouponAction(fd: FormData) {
  const { reseller } = await requireReseller();
  const id = str(fd, "id", 40);
  return act("/dashboard/coupons", async () => {
    const c = await db.coupon.findFirst({ where: { id, resellerId: reseller.id } });
    if (!c) throw new UserError("Coupon not found.");
    if (str(fd, "op") === "delete") {
      const used = await db.order.count({ where: { couponId: id } });
      if (used) {
        await db.coupon.update({ where: { id }, data: { active: false } });
        return "Coupon was used by orders, so it was deactivated instead of deleted.";
      }
      await db.coupon.delete({ where: { id } });
      return "Coupon deleted.";
    }
    await db.coupon.update({ where: { id }, data: { active: !c.active } });
    return c.active ? "Coupon deactivated." : "Coupon activated.";
  });
}
