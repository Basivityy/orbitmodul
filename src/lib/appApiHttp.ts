import { validDeviceId } from "@/core/appApi";
import { AppApiError, type AppLoginResponse } from "./appApi";
import { rateLimit } from "./ratelimit";
import { refreshPublicUrl } from "./publicUrl";

/** Apps (incl. Samsung Tizen / LG webOS web apps) call from any origin; no cookies are used. */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function ipOf(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Shared wrapper: JSON body, device id check, rate limits, JSON errors. */
export async function handle(req: Request, name: string, fn: (body: Record<string, unknown>, deviceId: string) => Promise<AppLoginResponse>): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    await refreshPublicUrl();
    const ip = ipOf(req);
    if (!(await rateLimit(`app:${name}:${ip}`, 60, 600))) throw new AppApiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      throw new AppApiError(400, "invalid_json", "Send a JSON body.");
    }
    if (!body || typeof body !== "object") throw new AppApiError(400, "invalid_json", "Send a JSON body.");
    if (!validDeviceId(body.deviceId)) throw new AppApiError(400, "invalid_device", "deviceId is required (6–128 letters, numbers, : . _ -).");
    const codeKey = String(body.code ?? body.loginCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (codeKey && !(await rateLimit(`app:code:${codeKey}`, 30, 600))) throw new AppApiError(429, "rate_limited", "Too many attempts for this code. Please wait a few minutes.");
    return json(200, await fn(body, body.deviceId as string));
  } catch (e) {
    if (e instanceof AppApiError) return json(e.httpStatus, { status: "error", error: e.code, message: e.message });
    console.error(`[app-api] ${name}`, (e as Error).message);
    return json(500, { status: "error", error: "server_error", message: "Something went wrong. Please try again." });
  }
}
