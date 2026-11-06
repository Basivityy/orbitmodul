"use client";

import { ErrorView } from "@/components/ErrorView";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView error={error} reset={reset} home="/dashboard" />;
}
