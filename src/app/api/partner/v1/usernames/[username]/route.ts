import { partnerHandle } from "@/lib/partnerHttp";
import { checkUsername } from "@/lib/partnerApi";

export const dynamic = "force-dynamic";

/** GET /usernames/{username} — is the username free and valid? */
export async function GET(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return partnerHandle(req, (r) => checkUsername(r, decodeURIComponent(username).slice(0, 60)));
}
