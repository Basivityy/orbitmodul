import { Prisma } from "@prisma/client";
import { db } from "./db";

export const SETTING_BILLING_ENABLED = "billing_enabled";
export const SETTING_REGISTRATION_OPEN = "registration_open";
export const SETTING_GLOBAL_NOTICE = "global_notice";
/** Super Admin switch: every store offers a simulated "Test payment" at checkout (no real money). */
export const SETTING_STORE_TEST_PAYMENTS = "store_test_payments";
/** Super Admin switch: resellers pay for the platform (SaaS plans, trial, limits). Off = free for approved resellers. */
export const SETTING_RESELLER_PLANS = "reseller_plans_enabled";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  // A Json column cannot take a plain null: store a JSON null instead (e.g. "remove app icon").
  const v = value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  await db.platformSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export async function platformBillingEnabled(): Promise<boolean> {
  return getSetting<boolean>(SETTING_BILLING_ENABLED, true);
}

export async function storeTestPaymentsEnabled(): Promise<boolean> {
  return getSetting<boolean>(SETTING_STORE_TEST_PAYMENTS, false);
}

export async function resellerPlansEnabled(): Promise<boolean> {
  return getSetting<boolean>(SETTING_RESELLER_PLANS, false);
}
