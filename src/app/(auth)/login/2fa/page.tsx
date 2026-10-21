import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { getPendingTwoFactorUser } from "@/lib/auth";
import { twoFactorAction } from "../../actions";

export const metadata = { title: "Two-factor authentication" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  if (!(await getPendingTwoFactorUser())) redirect("/login");
  return (
    <div className="card card-pad sm:p-8">
      <h1 className="mb-1">Two-factor authentication</h1>
      <p className="muted mb-6">Enter the 6-digit code from your authenticator app.</p>
      <Flash sp={sp} />
      <form action={twoFactorAction} className="space-y-4">
        <input className="input text-center text-2xl tracking-[0.4em]" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
        <SubmitButton className="btn-primary w-full">Verify</SubmitButton>
      </form>
    </div>
  );
}
