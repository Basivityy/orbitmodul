import { PartnerApiError } from "@/core/partnerApi";
import { authenticate, type ApiReseller } from "./partnerApi";
import { refreshPublicUrl } from "./publicUrl";

/**
 * Website API wrapper: Bearer key, JSON in/out, JSON errors { error, message }.
 * No CORS on purpose: the key is secret and must only be used from the reseller's server.
 */
export async function partnerHandle(req: Request, fn: (r: ApiReseller, body: Record<string, unknown>, url: URL) => Promise<unknown>): Promise<Response> {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  try {
    await refreshPublicUrl();
    const { reseller } = await authenticate(req);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        const parsed = await req.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        body = parsed as Record<string, unknown>;
      } catch {
        throw new PartnerApiError(400, "invalid_json", "Send a JSON object body with Content-Type: application/json.");
      }
    }
    return json(200, await fn(reseller, body, new URL(req.url)));
  } catch (e) {
    if (e instanceof PartnerApiError) return json(e.httpStatus, { error: e.code, message: e.message });
    console.error("[partner-api]", req.method, new URL(req.url).pathname, (e as Error).message);
    return json(500, { error: "server_error", message: "Something went wrong. Try again — with the same external_ref nothing is created twice." });
  }
}
