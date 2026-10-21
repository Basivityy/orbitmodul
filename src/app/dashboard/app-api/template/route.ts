import { requireReseller } from "@/lib/auth";
import { appTemplateHtml } from "@/lib/appTemplate";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Download: starter app preconfigured for this reseller (API address + own store). */
export async function GET() {
  const { reseller } = await requireReseller();
  const html = appTemplateHtml({ apiBase: `${env.appUrl}/api/app/v1`, store: reseller.slug, appName: reseller.storeName, brandColor: reseller.primaryColor });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="app-template-${reseller.slug}.html"` } });
}
