import { partnerHandle } from "@/lib/partnerHttp";

export const dynamic = "force-dynamic";

/** GET /ping — checks the key. */
export function GET(req: Request) {
  return partnerHandle(req, async (r) => ({ ok: true, store: r.storeName, currency: r.defaultCurrency }));
}
