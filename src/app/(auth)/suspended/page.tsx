import { SubmitButton } from "@/components/client";
import { logoutAction } from "../actions";

export const metadata = { title: "Account suspended" };

export default function SuspendedPage() {
  return (
    <div className="card card-pad text-center sm:p-8">
      <h1 className="mb-2">Account suspended</h1>
      <p className="muted mb-6">Your reseller account has been suspended by the platform administrator. Your customers&apos; existing lines are not changed. Please contact support.</p>
      <form action={logoutAction}>
        <SubmitButton className="btn-secondary">Sign out</SubmitButton>
      </form>
    </div>
  );
}
