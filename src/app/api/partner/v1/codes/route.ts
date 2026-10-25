import { partnerHandle } from "@/lib/partnerHttp";
import { createCodesApi } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** POST /codes — create activation codes for a package. */
export function POST(req: Request) {
  return partnerHandle(req, (r, body) => createCodesApi(r, body));
}
