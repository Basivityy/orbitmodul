import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="card card-pad sm:p-8">
      <h1 className="mb-6">Choose a new password</h1>
      <Flash sp={sp} />
      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={sp.token ?? ""} />
        <input className="input" name="password" type="password" minLength={10} required autoComplete="new-password" placeholder="New password" />
        <SubmitButton className="btn-primary w-full">Save password</SubmitButton>
      </form>
    </div>
  );
}
