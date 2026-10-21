import { redirect } from "next/navigation";
import { MaxPlayerError } from "@/core/adapters/maxplayer";
import { PanelApiError } from "@/core/adapters/types";
import { PaymentProviderError } from "@/core/payments";
import { CheckoutError } from "./orders";

/** An error whose message is safe and meant to be shown to the user. */
export class UserError extends Error {}

function userMessage(e: unknown): string {
  if (e instanceof UserError || e instanceof CheckoutError) return e.message;
  if (e instanceof PanelApiError) return `Panel API: ${e.message}`;
  if (e instanceof MaxPlayerError) return `MaxPlayer API: ${e.message}`;
  if (e instanceof PaymentProviderError) return e.message;
  if (e && typeof e === "object" && "issues" in e) {
    const issue = (e as { issues: Array<{ path: (string | number)[]; message: string }> }).issues[0];
    return issue ? `${issue.path.join(".") || "Input"}: ${issue.message}` : "Invalid input";
  }
  console.error("[action]", e);
  return "Something went wrong. Please try again.";
}

function withParam(path: string, key: string, value: string): string {
  const [base, hash] = path.split("#");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${key}=${encodeURIComponent(value.slice(0, 300))}${hash ? "#" + hash : ""}`;
}

/**
 * Runs a server-action body and redirects back with a flash message.
 * `fn` must not call redirect() itself; return { redirect } to go elsewhere.
 * Authorization (requireReseller/requireAdmin) is done BEFORE calling act().
 */
export async function act(back: string, fn: () => Promise<string | void | { redirect: string; message?: string }>): Promise<never> {
  let target: string;
  try {
    const r = await fn();
    if (r && typeof r === "object") target = r.message ? withParam(r.redirect, "ok", r.message) : r.redirect;
    else target = withParam(back, "ok", r || "Saved.");
  } catch (e) {
    target = withParam(back, "err", userMessage(e));
  }
  redirect(target);
}

export function str(fd: FormData, key: string, max = 2000): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function optStr(fd: FormData, key: string, max = 2000): string | null {
  const v = str(fd, key, max);
  return v.length ? v : null;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function int(fd: FormData, key: string, opts: { min?: number; max?: number; fallback?: number } = {}): number {
  const n = parseInt(str(fd, key), 10);
  if (!Number.isFinite(n)) {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new UserError(`${key} must be a number.`);
  }
  if (opts.min !== undefined && n < opts.min) throw new UserError(`${key} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw new UserError(`${key} must be at most ${opts.max}.`);
  return n;
}
