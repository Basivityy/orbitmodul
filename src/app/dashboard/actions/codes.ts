"use server";

import { act, int, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { createCodes, MAX_CODES_PER_BATCH } from "@/lib/codes";
import { db } from "@/lib/db";
import { CheckoutError } from "@/lib/orders";

export async function createCodesAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  return act("/dashboard/codes", async () => {
    const packageId = str(fd, "packageId", 40);
    const count = int(fd, "count", { min: 1, max: MAX_CODES_PER_BATCH });
    const batch = str(fd, "batch", 60).trim() || null;
    const pkg = await db.package.findFirst({ where: { id: packageId, resellerId: reseller.id }, include: { panel: true } });
    if (!pkg) throw new UserError("Select a package.");
    if (/reseller/i.test(pkg.panel.apiUrl) && !pkg.externalPackageId) throw new UserError(`“${pkg.name}” is not linked to a panel package. Open the package and choose “Panel package” first.`);
    let codes: string[];
    try {
      codes = await createCodes(reseller.id, pkg.id, count, batch);
    } catch (e) {
      if (e instanceof CheckoutError) throw new UserError(e.message);
      throw e;
    }
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "codes.created", target: pkg.id, meta: { count: codes.length, batch } });
    return { redirect: `/dashboard/codes?package=${pkg.id}${batch ? `&batch=${encodeURIComponent(batch)}` : ""}&status=UNUSED`, message: `${codes.length} code(s) created for “${pkg.name}”.` };
  });
}

export async function voidCodeAction(fd: FormData) {
  const { user, reseller } = await requireReseller();
  const back = str(fd, "back", 300);
  return act(back.startsWith("/dashboard/codes") ? back : "/dashboard/codes", async () => {
    const id = str(fd, "id", 40);
    const r = await db.activationCode.updateMany({ where: { id, resellerId: reseller.id, status: "UNUSED" }, data: { status: "VOID" } });
    if (r.count !== 1) throw new UserError("Only unused codes can be voided.");
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "codes.voided", target: id });
    return "Code voided — it can no longer be used.";
  });
}
