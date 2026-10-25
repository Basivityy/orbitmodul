import { partnerHandle } from "@/lib/partnerHttp";
import { getOrder } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** GET /orders/{id | number | external_ref} — status; login details once completed. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return partnerHandle(req, (r) => getOrder(r, decodeURIComponent(id).slice(0, 120)));
}
