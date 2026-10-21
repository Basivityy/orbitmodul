import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Forgot password" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="card card-pad sm:p-8">
      <h1 className="mb-1">Reset your password</h1>
      <p className="muted mb-6">We will email you a link to choose a new password.</p>
      <Flash sp={sp} />
      <form action={forgotPasswordAction} className="space-y-4">
        <input className="input" name="email" type="email" placeholder="you@example.com" required />
        <SubmitButton className="btn-primary w-full">Send reset link</SubmitButton>
      </form>
      <p className="muted mt-6 text-center"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}
