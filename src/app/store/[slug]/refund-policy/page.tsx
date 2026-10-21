import { notFound } from "next/navigation";
import { resolveStore } from "@/lib/storefront";

export const metadata = { title: "Refund policy" };

export default async function RefundPolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { reseller } = await resolveStore(slug);
  if (!reseller.refundPolicy) notFound();
  return (
    <article className="card card-pad mx-auto max-w-3xl sm:p-8">
      <h1 className="mb-4">Refund policy</h1>
      <div className="whitespace-pre-line text-sm leading-relaxed">{reseller.refundPolicy}</div>
    </article>
  );
}
