import type { Prisma } from "@prisma/client";
import { db } from "./db";

/** Lists of the "Expiring lines" page (shared by the page and the bulk reminder). */
export const EXPIRING_TABS = [
  { key: "7", label: "Next 7 days" },
  { key: "30", label: "Next 30 days" },
  { key: "expired", label: "Expired, not renewed (30 days)" },
] as const;
export type ExpiringTab = (typeof EXPIRING_TABS)[number]["key"];

export function expiringWhere(resellerId: string, tab: ExpiringTab, now = new Date()): Prisma.SubscriptionWhereInput {
  const day = 86_400_000;
  const base: Prisma.SubscriptionWhereInput = { resellerId, isTest: false, xuiLineId: { not: null } };
  if (tab === "expired") return { ...base, status: "EXPIRED", expiresAt: { gte: new Date(now.getTime() - 30 * day), lt: now } };
  return { ...base, status: "ACTIVE", autoRenew: false, expiresAt: { gte: now, lte: new Date(now.getTime() + Number(tab) * day) } };
}

export function parseExpiringTab(v: string | undefined): ExpiringTab {
  return (EXPIRING_TABS.find((t) => t.key === v)?.key ?? "7") as ExpiringTab;
}
