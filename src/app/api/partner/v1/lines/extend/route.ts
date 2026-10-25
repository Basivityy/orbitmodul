import { partnerHandle } from "@/lib/partnerHttp";
import { extendLine } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /lines/extend — extend a line (paid on your website). */
export function POST(req: Request) {
  return partnerHandle(req, (r, body) => extendLine(r, body));
}
