import { partnerHandle } from "@/lib/partnerHttp";
import { createLine, findLines } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /lines?username=… | ?email=… — find lines. */
export function GET(req: Request) {
  return partnerHandle(req, (r, _b, url) => findLines(r, url.searchParams));
}

/** POST /lines — new line (paid on your website). */
export function POST(req: Request) {
  return partnerHandle(req, (r, body) => createLine(r, body));
}
