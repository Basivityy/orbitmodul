import { getAppIcon } from "@/lib/appGuide";

export const dynamic = "force-dynamic";

/** App icon uploaded by the Super Admin (shown on order pages and in activation emails). */
export async function GET() {
  const icon = await getAppIcon();
  if (!icon) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(icon.b64, "base64"), {
    headers: { "Content-Type": icon.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
