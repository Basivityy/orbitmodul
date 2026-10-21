import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logoutAction, resendVerificationPendingAction } from "../actions";

export const metadata = { title: "Waiting for approval" };
export const dynamic = "force-dynamic";

export default async function PendingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "RESELLER") redirect("/admin");
  const reseller = await db.reseller.findUnique({ where: { ownerUserId: user.id } });
  if (!reseller || reseller.approvalStatus === "APPROVED") redirect("/dashboard");
  const rejected = reseller.approvalStatus === "REJECTED";
  return (
    <div className="card card-pad text-center sm:p-8">
      <Flash sp={sp} />
      {rejected ? (
        <>
          <h1 className="mb-2">Application not approved</h1>
          <p className="muted mb-4">Unfortunately your reseller account for <b>{reseller.storeName}</b> was not approved.</p>
          {reseller.approvalNote && <p className="mb-4 rounded-lg bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/60">{reseller.approvalNote}</p>}
          <p className="muted mb-6 text-sm">If you think this is a mistake, reply to the email you received from {env.platformName}.</p>
        </>
      ) : (
        <>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl dark:bg-amber-500/15" aria-hidden>⏳</div>
          <h1 className="mb-2">Waiting for approval</h1>
          <p className="muted mb-4">
            Thank you, your request for <b>{reseller.storeName}</b> was received. Every request is reviewed by the {env.platformName} team. You will get an email at <b>{user.email}</b> as soon as your account is approved.
          </p>
          {!user.emailVerifiedAt ? (
            <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="mb-2">Please also confirm your email address (link in the email we sent you).</p>
              <form action={resendVerificationPendingAction}>
                <SubmitButton className="btn-secondary btn-sm">Resend confirmation email</SubmitButton>
              </form>
            </div>
          ) : (
            <p className="mb-6 text-sm text-emerald-700 dark:text-emerald-300">✓ Email address confirmed</p>
          )}
        </>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {!rejected && <Link className="btn-secondary" href="/pending">Check again</Link>}
        <form action={logoutAction}>
          <SubmitButton className="btn-ghost">Sign out</SubmitButton>
        </form>
      </div>
    </div>
  );
}
