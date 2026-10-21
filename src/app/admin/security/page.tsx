import { Flash, PageHeader } from "@/components/ui";
import { SecurityPanel } from "@/components/SecurityPanel";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "My security" };

export default async function AdminSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="My security" description="Two-factor authentication is strongly recommended for every administrator." />
      <Flash sp={sp} />
      <SecurityPanel user={user} />
    </>
  );
}
