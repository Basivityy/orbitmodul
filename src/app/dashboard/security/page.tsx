import { Flash, PageHeader } from "@/components/ui";
import { SecurityPanel } from "@/components/SecurityPanel";
import { requireReseller } from "@/lib/auth";

export const metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { user } = await requireReseller();
  return (
    <>
      <PageHeader title="Security" />
      <Flash sp={sp} />
      <SecurityPanel user={user} />
    </>
  );
}
