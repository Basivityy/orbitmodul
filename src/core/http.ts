export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
  json: any;
  headers: Record<string, string>;
  durationMs: number;
}

export class HttpError extends Error {
  constructor(message: string, public status?: number, public body?: string) {
    super(message);
    this.name = "HttpError";
  }
}

/** fetch with timeout; never throws on non-2xx (caller decides), throws on network/timeout. */
export async function httpRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  const started = Date.now();
  try {
    const res = await fetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body, signal: controller.signal, redirect: "follow" });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, ok: res.ok, text, json, headers, durationMs: Date.now() - started };
  } catch (e: any) {
    if (e?.name === "AbortError") throw new HttpError(`Request timed out after ${init.timeoutMs ?? 20_000} ms`);
    throw new HttpError(`Network error: ${e?.cause?.code ?? e?.message ?? "unknown"}`);
  } finally {
    clearTimeout(timer);
  }
}

/** application/x-www-form-urlencoded with support for arrays (key[]=a&key[]=b) and nested keys. */
export function formEncode(data: Record<string, string | number | boolean | undefined | null | Array<string | number>>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}

/** Remove secrets from text before it is logged or shown. */
export function redact(text: string, secrets: Array<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("***");
  return out.replace(/api_key=[^&\s"]+/gi, "api_key=***");
}
