import { appActivate } from "@/lib/appApi";
import { handle, preflight } from "@/lib/appApiHttp";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** { code, deviceId, deviceName?, store? } → activates a new code or signs in with the line's code. */
export function POST(req: Request) {
  return handle(req, "activate", (b, deviceId) => appActivate(b.code, deviceId, typeof b.deviceName === "string" ? b.deviceName.slice(0, 80) : null, b.store));
}
