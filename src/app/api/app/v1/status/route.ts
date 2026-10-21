import { appStatus } from "@/lib/appApi";
import { handle, preflight } from "@/lib/appApiHttp";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** { loginCode, deviceId, store? } → current login details and expiry (call on app start). */
export function POST(req: Request) {
  return handle(req, "status", (b, deviceId) => appStatus(b.loginCode, deviceId, b.store));
}
