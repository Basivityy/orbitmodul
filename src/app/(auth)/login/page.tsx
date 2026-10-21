import Link from "next/link";
import { redirect } from "next/navigation";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(user.role === "RESELLER" ? "/dashboard" : "/admin");
  return (
    <div className="card card-pad sm:p-8">
      <h1 className="mb-1">Sign in</h1>
      <p className="muted mb-6">Access your reseller dashboard.</p>
      <Flash sp={sp} />
      <form action={loginAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <div className="flex justify-between">
            <label className="label" htmlFor="password">Password</label>
            <Link href="/forgot-password" className="text-sm">Forgot?</Link>
          </div>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn-primary w-full">Sign in</SubmitButton>
      </form>
      <p className="muted mt-6 text-center">
        New reseller? <Link href="/register">Request an account</Link>
      </p>
    </div>
  );
}
