"use server";

import { act, str, UserError } from "@/lib/action";
import { issueAppCode } from "@/lib/appApi";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { CheckoutError } from "@/lib/orders";

export async function issueAppCodeAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(`/dashboard/subscriptions/${id}`, async () => {
    let c: string;
    try {
      c = await issueAppCode(reseller.id, id);
    } catch (e) {
      if (e instanceof CheckoutError) throw new UserError(e.message);
      throw e;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "app.code_issued", target: id });
    return `App code created: ${c}. Give it to the customer — they sign in to the app with it.`;
  });
}

export async function resetAppDevicesAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const id = str(fd, "subscriptionId", 40);
  return act(`/dashboard/subscriptions/${id}`, async () => {
    const s = await db.subscription.findFirst({ where: { id, resellerId: reseller.id }, select: { id: true } });
    if (!s) throw new UserError("Subscription not found.");
    const r = await db.appDevice.deleteMany({ where: { subscriptionId: s.id } });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "app.devices_reset", target: id, meta: { count: r.count } });
    return `${r.count} device(s) signed out. The customer can sign in again with the code.`;
  });
}
