import Link from "next/link";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/ui";
import { env } from "@/lib/env";
import { registerAction } from "../actions";

export const metadata = { title: "Reseller request" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="card card-pad sm:p-8">
      <h1 className="mb-1">Request a reseller account</h1>
      <p className="muted mb-6">Fill in the form and submit your request. We review every request and send you an email as soon as your account is approved.</p>
      <Flash sp={sp} />
      <form action={registerAction} className="space-y-4">
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" required maxLength={100} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
          <p className="hint">At least 10 characters, letters and numbers.</p>
        </div>
        <div>
          <label className="label" htmlFor="storeName">Store name</label>
          <input className="input" id="storeName" name="storeName" required maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="slug">Store address</label>
          <div className="flex items-center gap-1">
            <span className="muted whitespace-nowrap">{env.appUrl.replace(/^https?:\/\//, "")}/store/</span>
            <input className="input" id="slug" name="slug" pattern="[a-z0-9-]{3,40}" placeholder="my-store" />
          </div>
          <p className="hint">Leave empty to generate it from the store name. You can connect your own domain later.</p>
        </div>
        <SubmitButton className="btn-primary w-full">Submit request</SubmitButton>
      </form>
      <p className="muted mt-6 text-center">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
