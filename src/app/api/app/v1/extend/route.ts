import { appExtend } from "@/lib/appApi";
import { handle, preflight } from "@/lib/appApiHttp";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** { loginCode, code, deviceId, store? } → applies a new activation code to the same line. */
export function POST(req: Request) {
  return handle(req, "extend", (b, deviceId) => appExtend(b.loginCode, b.code, deviceId, b.store));
}
