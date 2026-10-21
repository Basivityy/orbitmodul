import { cachedPublicUrl, refreshPublicUrl } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";

/** Used by the middleware: hosts that serve the platform itself (the domain set by the Super Admin). */
export async function GET() {
  await refreshPublicUrl(10_000);
  const url = cachedPublicUrl();
  let hosts: string[] = [];
  try {
    if (url) hosts = [new URL(url).host.toLowerCase()];
  } catch {
    hosts = [];
  }
  return Response.json({ hosts }, { headers: { "Cache-Control": "no-store" } });
}
