"use server";

import { act, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { cancelPlan, createPlanCheckout, platformBillingConfigured } from "@/lib/platformBilling";
import { resellerPlansEnabled } from "@/lib/settings";

export async function choosePlanAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/billing", async () => {
    if (!(await resellerPlansEnabled())) throw new UserError("The platform is free to use — there is no plan to choose.");
    if (!platformBillingConfigured()) throw new UserError("Online plan payments are not set up yet. Please contact the platform administrator.");
    const url = await createPlanCheckout(reseller.id, str(fd, "planId", 40), user.email);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "saas.checkout_started", target: str(fd, "planId", 40) });
    return { redirect: url };
  });
}

export async function cancelPlanAction() {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/billing", async () => {
    await cancelPlan(reseller.id);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "saas.canceled" });
    return "Your plan will end at the end of the current billing period.";
  });
}
