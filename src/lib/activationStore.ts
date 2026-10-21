import { decrypt, encrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { MaxPlayerClient } from "@/core/adapters/maxplayer";
import type { ActivationContext, ActivationStore, MaxPlayerContext, MaxPlayerStore, PackageSnapshot, PanelFactory } from "@/core/activation/engine";
import { apiLogger } from "./audit";
import { db } from "./db";
import { env } from "./env";
import { platformBillingEnabled } from "./settings";

/** Effective test mode: the panel setting OR the global "live operations not approved" switch. */
export function effectiveTestMode(panelTestMode: boolean): boolean {
  return panelTestMode || !env.liveOperationsAllowed;
}

export class PrismaActivationStore implements ActivationStore {
  async load(orderId: string): Promise<ActivationContext | null> {
    const o = await db.order.findUnique({
      where: { id: orderId },
      include: { customer: true, subscription: true, reseller: true, package: { include: { panel: true } } },
    });
    if (!o) return null;
    const panelRow = o.subscription ? await db.panelIntegration.findUnique({ where: { id: o.subscription.panelId } }) : o.package.panel;
    if (!panelRow) return null;
    return {
      order: {
        id: o.id,
        number: o.number,
        kind: o.kind,
        status: o.status,
        attempts: o.attempts,
        snapshot: { ...(o.packageSnapshot as unknown as PackageSnapshot), panelPackageId: (o.packageSnapshot as any)?.panelPackageId ?? o.package.externalPackageId },
        lineUsername: o.lineUsername,
        linePassword: o.linePasswordEnc ? decrypt(o.linePasswordEnc) : null,
        plannedExpiresAt: o.plannedExpiresAt,
        subscriptionId: o.subscriptionId,
        customerEmail: o.customer.email,
        // Online purchases and activation codes: the customer chose the username → add 2 digits if taken.
        autoRenameTakenUsername: o.provider !== "MANUAL" || (o.providerPaymentId ?? "").startsWith("code-"),
      },
      subscription: o.subscription ? { id: o.subscription.id, xuiLineId: o.subscription.xuiLineId, lineUsername: o.subscription.lineUsername, expiresAt: o.subscription.expiresAt, maxPlayerStatus: o.subscription.maxPlayerStatus } : null,
      panel: {
        id: panelRow.id,
        type: panelRow.type,
        testMode: effectiveTestMode(panelRow.testMode),
        config: { apiUrl: panelRow.apiUrl, apiKey: decrypt(panelRow.apiKeyEnc), extraParams: (panelRow.extraParams as Record<string, string>) ?? {}, lineOwnerId: panelRow.lineOwnerId },
      },
      reseller: { id: o.reseller.id, active: o.reseller.status === "ACTIVE", billingEnabled: o.reseller.billingEnabled, linePrefix: o.reseller.linePrefix },
      platformBillingEnabled: await platformBillingEnabled(),
    };
  }

  async claim(orderId: string, leaseMs: number, now: Date): Promise<boolean> {
    const res = await db.order.updateMany({
      where: {
        id: orderId,
        status: { in: ["PAID", "ACTIVATING", "ACTIVATION_FAILED", "ON_HOLD"] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: { status: "ACTIVATING", lockedUntil: new Date(now.getTime() + leaseMs), attempts: { increment: 1 } },
    });
    return res.count === 1;
  }

  async savePlan(orderId: string, plan: { username?: string; password?: string; expiresAt: Date }): Promise<void> {
    await db.order.update({
      where: { id: orderId },
      data: {
        plannedExpiresAt: plan.expiresAt,
        ...(plan.username ? { lineUsername: plan.username } : {}),
        ...(plan.password ? { linePasswordEnc: encrypt(plan.password) } : {}),
      },
    });
  }

  async completeNew(orderId: string, r: { lineId: string; username: string; password: string; startsAt: Date; expiresAt: Date; test: boolean }) {
    return db.$transaction(async (tx) => {
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { package: true } });
      const snap = o.packageSnapshot as unknown as PackageSnapshot;
      const data = {
        status: "ACTIVE" as const,
        startsAt: r.startsAt,
        expiresAt: r.expiresAt,
        xuiLineId: r.lineId,
        lineUsername: r.username,
        linePasswordEnc: encrypt(r.password),
        isTest: r.test,
        maxPlayerStatus: snap.maxPlayerEnabled ? ("PENDING" as const) : ("NONE" as const),
      };
      let subscriptionId = o.subscriptionId;
      if (subscriptionId) {
        await tx.subscription.update({ where: { id: subscriptionId }, data });
      } else {
        const sub = await tx.subscription.create({
          data: {
            ...data,
            resellerId: o.resellerId,
            customerId: o.customerId,
            packageId: o.packageId,
            panelId: o.package.panelId,
            priceCents: o.amountCents,
            currency: o.currency,
            durationDays: snap.durationDays,
            provider: o.provider,
            providerSubscriptionId: o.providerSubscriptionId,
            autoRenew: !!o.providerSubscriptionId,
          },
        });
        subscriptionId = sub.id;
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "COMPLETED", activatedAt: new Date(), lockedUntil: null, errorMessage: null, subscriptionId } });
      await tx.transaction.updateMany({ where: { orderId, subscriptionId: null }, data: { subscriptionId } });
      return { subscriptionId };
    });
  }

  async completeRenewal(orderId: string, r: { subscriptionId: string; expiresAt: Date }) {
    await db.$transaction([
      db.subscription.update({ where: { id: r.subscriptionId }, data: { expiresAt: r.expiresAt, status: "ACTIVE", reminderSentAt: null } }),
      db.order.update({ where: { id: orderId }, data: { status: "COMPLETED", activatedAt: new Date(), lockedUntil: null, errorMessage: null } }),
      db.transaction.updateMany({ where: { orderId, subscriptionId: null }, data: { subscriptionId: r.subscriptionId } }),
    ]);
  }

  async fail(orderId: string, message: string, final: boolean) {
    await db.order.update({ where: { id: orderId }, data: { errorMessage: message, lockedUntil: null, ...(final ? { status: "ACTIVATION_FAILED" } : {}) } });
  }

  async hold(orderId: string, reason: string) {
    await db.order.updateMany({ where: { id: orderId, status: { in: ["PAID", "ACTIVATING", "ACTIVATION_FAILED", "ON_HOLD"] } }, data: { status: "ON_HOLD", errorMessage: reason, lockedUntil: null } });
  }
}

export const prismaPanelFactory: PanelFactory = (panel, resellerId, orderId) =>
  createPanelAdapter(panel.type, panel.config, { testMode: panel.testMode, log: apiLogger(resellerId, "XUI", orderId) });

export class PrismaMaxPlayerStore implements MaxPlayerStore {
  async load(subscriptionId: string): Promise<MaxPlayerContext | null> {
    const s = await db.subscription.findUnique({ where: { id: subscriptionId }, include: { customer: true, reseller: { include: { maxPlayer: true } } } });
    if (!s) return null;
    const mp = s.reseller.maxPlayer;
    return {
      subscription: {
        id: s.id,
        lineUsername: s.lineUsername,
        linePassword: s.linePasswordEnc ? decrypt(s.linePasswordEnc) : null,
        maxPlayerUserId: s.maxPlayerUserId,
        customerEmail: s.customer.email,
        customerName: s.customer.name,
      },
      integration: mp
        ? { apiKey: decrypt(mp.apiKeyEnc), domainId: mp.domainId, enabled: mp.enabled, testMode: effectiveTestMode(mp.testMode) || s.isTest, maxDevices: mp.maxDevices, maxProfiles: mp.maxProfiles }
        : null,
      reseller: { active: s.reseller.status === "ACTIVE", billingEnabled: s.reseller.billingEnabled },
    };
  }
  async markPending(id: string) {
    await db.subscription.update({ where: { id }, data: { maxPlayerStatus: "PENDING" } });
  }
  async markActive(id: string, mpId: string) {
    await db.subscription.update({ where: { id }, data: { maxPlayerStatus: "ACTIVE", maxPlayerUserId: mpId, maxPlayerError: null } });
  }
  async markFailed(id: string, message: string) {
    await db.subscription.update({ where: { id }, data: { maxPlayerStatus: "FAILED", maxPlayerError: message } });
  }
  async markWaiting(id: string, message: string) {
    await db.subscription.update({ where: { id }, data: { maxPlayerStatus: "PENDING", maxPlayerError: message } });
  }
}

export function maxPlayerClientFactory(resellerId: string) {
  return (apiKey: string) => new MaxPlayerClient(apiKey, process.env.MAXPLAYER_API_BASE || undefined, apiLogger(resellerId, "MAXPLAYER"));
}
