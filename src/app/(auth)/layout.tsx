import Link from "next/link";
import { ThemeToggle } from "@/components/client";
import { BrandMark } from "@/components/BrandMark";
import { env } from "@/lib/env";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="hazard" aria-hidden />
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-extrabold text-slate-950 no-underline hover:no-underline dark:text-white" style={{ fontStretch: "125%" }}>
          <BrandMark size={30} />
          {env.platformName}
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
