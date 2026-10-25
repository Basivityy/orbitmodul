import { LoadingView } from "@/components/LoadingView";

/** Any page without its own loading screen (login, register, home…). */
export default function Loading() {
  return <div className="mx-auto max-w-xl px-4 py-16"><LoadingView variant="plain" /></div>;
}
