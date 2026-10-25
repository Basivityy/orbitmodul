import { partnerHandle } from "@/lib/partnerHttp";
import { listPackages } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** GET /packages — packages on sale (price, duration, connections, bouquet names). */
export function GET(req: Request) {
  return partnerHandle(req, (r) => listPackages(r));
}
