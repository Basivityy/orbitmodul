import { partnerHandle } from "@/lib/partnerHttp";
import { getCode } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** GET /codes/{code} — is the code used, and for which line? */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return partnerHandle(req, (r) => getCode(r, decodeURIComponent(code).slice(0, 40)));
}
