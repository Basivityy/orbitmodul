import type { Reseller, SaasPlan, SaasSubscription } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { platformBillingEnabled, resellerPlansEnabled } from "./settings";

export type ResellerWithSaas = Reseller & { saas: (SaasSubscription & { plan: SaasPlan }) | null };

/** Used while reseller plans are switched off: everything included, no limits, no expiry. */
const FREE_PLAN: SaasPlan = {
  id: "free",
  code: "FREE",
  name: "Free",
  priceCents: 0,
  currency: "EUR",
  interval: "MONTH",
  features: [],
  maxPackages: 100_000,
  maxPanels: 1_000,
  maxActiveCustomers: 10_000_000,
  allowCustomDomain: true,
  allowMaxPlayer: true,
  active: true,
  isDefault: false,
  sortOrder: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function freeSaas(r: Reseller): SaasSubscription & { plan: SaasPlan } {
  return {
    id: "free",
    resellerId: r.id,
    planId: FREE_PLAN.id,
    status: "ACTIVE",
    trialEndsAt: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    plan: FREE_PLAN,
  };
}

/**
 * Reseller with their platform plan. While reseller plans are switched off (Admin → Global settings)
 * every reseller gets the free, unlimited plan, so no limits or plan checks apply anywhere.
 */
export async function loadResellerSaas(resellerId: string): Promise<ResellerWithSaas> {
  const r = await db.reseller.findUniqueOrThrow({ where: { id: resellerId }, include: { saas: { include: { plan: true } } } });
  if (await resellerPlansEnabled()) return r;
  return { ...r, saas: freeSaas(r) };
}

export function saasActive(s: (SaasSubscription & { plan: SaasPlan }) | null, now = new Date()): boolean {
  if (!s) return false;
  if (s.status === "TRIALING") return !!s.trialEndsAt && s.trialEndsAt.getTime() > now.getTime();
  if (s.status === "ACTIVE" || s.status === "PAST_DUE") {
    // 3 days of grace after the paid period ends
    return !s.currentPeriodEnd || s.currentPeriodEnd.getTime() + 3 * 86_400_000 > now.getTime();
  }
  return false;
}

/** Reasons a reseller's store cannot accept new orders right now (empty array = can sell). */
export async function sellBlockers(r: ResellerWithSaas, ownerEmailVerified: boolean): Promise<string[]> {
  const out: string[] = [];
  if (!(await platformBillingEnabled())) out.push("The billing service is temporarily paused by the platform.");
  if (r.status !== "ACTIVE") out.push("This store is suspended.");
  if (r.approvalStatus !== "APPROVED") out.push("This store has not been approved by the platform yet.");
  if (!r.billingEnabled) out.push("The billing module is disabled for this store.");
  if (!saasActive(r.saas)) out.push("The store's platform subscription is not active.");
  if (!ownerEmailVerified) out.push("The store owner has not confirmed their email address yet.");
  return out;
}

export function planLimits(r: ResellerWithSaas) {
  const p = r.saas?.plan;
  return {
    maxPackages: p?.maxPackages ?? 0,
    maxPanels: p?.maxPanels ?? 0,
    maxActiveCustomers: p?.maxActiveCustomers ?? 0,
    allowCustomDomain: p?.allowCustomDomain ?? false,
    allowMaxPlayer: p?.allowMaxPlayer ?? false,
  };
}

export async function startTrial(resellerId: string): Promise<void> {
  if (await db.saasSubscription.findUnique({ where: { resellerId } })) return;
  const plan = (await db.saasPlan.findFirst({ where: { isDefault: true, active: true } })) ?? (await db.saasPlan.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } }));
  if (!plan) return;
  await db.saasSubscription.create({
    data: { resellerId, planId: plan.id, status: "TRIALING", trialEndsAt: new Date(Date.now() + env.trialDays * 86_400_000) },
  });
}
