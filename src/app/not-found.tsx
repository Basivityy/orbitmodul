import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or is no longer available.</p>
      <Link href="/" className="btn-secondary">Go home</Link>
    </div>
  );
}
