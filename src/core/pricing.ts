export interface PricedPackage {
  id: string;
  priceCents: number;
  currency: string;
  promoPriceCents?: number | null;
  promoEndsAt?: Date | null;
}

export interface CouponLike {
  code: string;
  type: "PERCENT" | "FIXED";
  value: number; // percent (1-100) or minor units
  currency?: string | null;
  maxRedemptions?: number | null;
  redemptions: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
  packageIds: string[];
  active: boolean;
}

/** Promo price applies while promoEndsAt is in the future (or has no end). */
export function effectivePrice(pkg: PricedPackage, now = new Date()): { amount: number; isPromo: boolean } {
  if (pkg.promoPriceCents != null && pkg.promoPriceCents >= 0 && pkg.promoPriceCents < pkg.priceCents) {
    if (!pkg.promoEndsAt || pkg.promoEndsAt.getTime() > now.getTime()) return { amount: pkg.promoPriceCents, isPromo: true };
  }
  return { amount: pkg.priceCents, isPromo: false };
}

export type CouponResult = { ok: true; discount: number; total: number } | { ok: false; error: string };

export function applyCoupon(subtotal: number, currency: string, packageId: string, coupon: CouponLike, now = new Date()): CouponResult {
  if (!coupon.active) return { ok: false, error: "This coupon is not active." };
  if (coupon.validFrom && coupon.validFrom.getTime() > now.getTime()) return { ok: false, error: "This coupon is not valid yet." };
  if (coupon.validUntil && coupon.validUntil.getTime() < now.getTime()) return { ok: false, error: "This coupon has expired." };
  if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) return { ok: false, error: "This coupon has been fully redeemed." };
  if (coupon.packageIds.length > 0 && !coupon.packageIds.includes(packageId)) return { ok: false, error: "This coupon does not apply to this package." };
  let discount: number;
  if (coupon.type === "PERCENT") {
    if (coupon.value <= 0 || coupon.value > 100) return { ok: false, error: "Invalid coupon." };
    discount = Math.round((subtotal * coupon.value) / 100);
  } else {
    if (coupon.currency && coupon.currency.toUpperCase() !== currency.toUpperCase()) return { ok: false, error: "This coupon is for a different currency." };
    discount = coupon.value;
  }
  discount = Math.min(Math.max(discount, 0), subtotal);
  return { ok: true, discount, total: subtotal - discount };
}
