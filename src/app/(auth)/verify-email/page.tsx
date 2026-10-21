import Link from "next/link";
import { consumeToken } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Confirm email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { token } = await searchParams;
  const t = token ? await consumeToken("EMAIL_VERIFY", token) : null;
  if (t?.userId) await db.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: new Date() } });
  const reseller = t?.userId ? await db.reseller.findUnique({ where: { ownerUserId: t.userId } }) : null;
  const waiting = reseller && reseller.approvalStatus !== "APPROVED";
  return (
    <div className="card card-pad text-center sm:p-8">
      <h1 className="mb-2">{t ? "Email confirmed ✓" : "Link invalid or expired"}</h1>
      <p className="muted mb-6">{t ? (waiting ? "Thank you. We will email you as soon as your reseller account is approved." : "Your store can now accept orders.") : "Request a new confirmation email from your dashboard."}</p>
      <Link className="btn-primary" href="/dashboard">Go to dashboard</Link>
    </div>
  );
}
