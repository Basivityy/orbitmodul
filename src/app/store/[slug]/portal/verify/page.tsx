import { SubmitButton } from "@/components/client";
import { resolveStore } from "@/lib/storefront";
import { portalVerifyAction } from "../../actions";

export const metadata = { title: "Sign in" };

/** The link only signs in after a click (POST), so email link scanners cannot consume it. */
export default async function PortalVerifyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string>> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { reseller } = await resolveStore(slug);
  return (
    <div className="mx-auto max-w-md">
      <div className="card card-pad text-center sm:p-8">
        <h1 className="mb-2">Sign in to {reseller.storeName}</h1>
        <p className="muted mb-6">Click the button to open your account.</p>
        <form action={portalVerifyAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="token" value={sp.token ?? ""} />
          <SubmitButton className="btn w-full text-white" style={{ background: "var(--brand)" }}>Continue to my account</SubmitButton>
        </form>
      </div>
    </div>
  );
}
