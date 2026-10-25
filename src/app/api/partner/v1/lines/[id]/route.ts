import { partnerHandle } from "@/lib/partnerHttp";
import { getLine } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** GET /lines/{id} — one line with login details. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return partnerHandle(req, (r) => getLine(r, id.slice(0, 60)));
}
