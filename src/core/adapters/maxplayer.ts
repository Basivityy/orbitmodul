import { httpRequest, HttpError, redact } from "../http";
import { ApiCallLogger } from "./types";

/**
 * MaxPlayer.tv public API v3 client — only endpoints from the supplied documentation:
 *   GET  /status                 (diagnostics — connection test)
 *   GET  /domains                (domain_id choices)
 *   GET  /device-ceiling, /profile-ceiling
 *   POST /users/search           (idempotency: find existing customer)
 *   POST /users                  (create customer + initial IPTV list)
 *   PUT  /users/list             (update IPTV credentials on the customer list)
 *   GET  /customers/{id}         (status/expiration sync)
 *   PUT  /users/{id}/device-limit, /users/{id}/profile-limit
 * Auth header: Api-Token (falls back to "Authorization: Bearer" once if a key is refused).
 * Note: the documented API has no endpoint to extend a MaxPlayer customer's expiry;
 * renewals keep the same IPTV credentials, so the player keeps working as long as the XUI line is active.
 */
export const MAXPLAYER_BASE = "https://api.maxplayer.tv/v3/api/public";

export class MaxPlayerError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
    /** MaxPlayer refused because too many requests were sent — wait, then try again (not a real failure). */
    public readonly rateLimited = false,
    /** How long MaxPlayer asked us to wait (Retry-After), if it said so. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "MaxPlayerError";
  }
}

/** "Too many requests" answers (HTTP 429, or the same said in the message). Account quotas are not matched. */
export function isRateLimitAnswer(status: number, message: string): boolean {
  return status === 429 || /too many requests|rate[ -]?limit|throttl|requests? limit|request quota|limit of requests/i.test(message);
}

/** Retry-After header (seconds or an HTTP date) → milliseconds, capped at 15 minutes. */
export function retryAfterMs(headers: Record<string, string> | undefined, now = Date.now()): number | undefined {
  const v = headers?.["retry-after"] ?? headers?.["x-ratelimit-reset-after"];
  if (!v) return undefined;
  const secs = Number(v);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(v) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 15 * 60_000) : undefined;
}

export interface MaxPlayerCustomer {
  id: string;
  username: string | null;
  email: string | null;
  expiresAt: string | null;
  raw: any;
}

/** How a key is sent. The documented header is "Api-Token"; "Authorization: Bearer" is the fallback. */
type AuthMode = "api-token" | "bearer";
/** Remembered per key (by fingerprint), so the fallback costs one extra request once, not every time. */
const authModes = new Map<string, AuthMode>();
function fingerprint(key: string): string {
  return `${key.length}:${key.slice(0, 8)}:${key.slice(-6)}`;
}

/** "mpk_61e54c72…3a28" — the same short form MaxPlayer shows under API keys, to see which key is used. */
export function maskApiKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  return k.length > 20 ? `${k.slice(0, 12)}…${k.slice(-4)}` : `${k.slice(0, 3)}…${k.slice(-2)}`;
}

export class MaxPlayerClient {
  private readonly apiKey: string;
  constructor(apiKey: string, private readonly base = MAXPLAYER_BASE, private readonly log: ApiCallLogger = () => {}, private readonly timeoutMs = 20_000) {
    // Keys pasted with spaces/new lines around them still work.
    this.apiKey = apiKey.trim();
  }

  private send(method: string, path: string, body: unknown, mode: AuthMode) {
    const auth: Record<string, string> = mode === "bearer" ? { Authorization: `Bearer ${this.apiKey}` } : { "Api-Token": this.apiKey };
    return httpRequest(this.base + path, {
      method,
      headers: { ...auth, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      timeoutMs: this.timeoutMs,
    });
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const action = `${method} ${path.replace(/\/\d+/g, "/{id}")}`;
    const fp = fingerprint(this.apiKey);
    const mode = authModes.get(fp) ?? "api-token";
    let res;
    try {
      res = await this.send(method, path, body, mode);
      // New-style keys (e.g. "mpk_…") may expect "Authorization: Bearer" — try that once when refused.
      if ((res.status === 401 || res.status === 403) && mode === "api-token" && !authModes.has(fp)) {
        const alt = await this.send(method, path, body, "bearer");
        if (alt.status !== 401 && alt.status !== 403) {
          authModes.set(fp, "bearer");
          res = alt;
        } else authModes.set(fp, "api-token"); // refused both ways: the key itself is wrong
      } else if (res.ok) authModes.set(fp, mode);
    } catch (e) {
      const msg = e instanceof HttpError ? e.message : String(e);
      this.log({ action, success: false, message: msg });
      throw new MaxPlayerError(msg, true);
    }
    if (!res.ok) {
      const detail = res.json?.error ?? res.json?.message ?? res.text.slice(0, 300);
      const msg = `HTTP ${res.status}: ${redact(String(detail), [this.apiKey])}`;
      this.log({ action, success: false, statusCode: res.status, durationMs: res.durationMs, message: msg });
      const limited = isRateLimitAnswer(res.status, String(detail));
      throw new MaxPlayerError(msg, res.status >= 500 || limited, res.status, limited, limited ? retryAfterMs(res.headers) : undefined);
    }
    // Some MaxPlayer errors come back as HTTP 200 with {"success": false, "message": "..."}.
    const j = res.json;
    if (j && typeof j === "object" && !Array.isArray(j) && (j.success === false || j.status === "error" || (typeof j.error === "string" && j.error))) {
      const msg = redact(String(j.message ?? j.error ?? "request was not accepted"), [this.apiKey]).slice(0, 300);
      this.log({ action, success: false, statusCode: res.status, durationMs: res.durationMs, message: msg });
      const limited = isRateLimitAnswer(res.status, msg);
      throw new MaxPlayerError(`MaxPlayer: ${msg}`, limited, res.status, limited, limited ? retryAfterMs(res.headers) : undefined);
    }
    this.log({ action, success: true, statusCode: res.status, durationMs: res.durationMs });
    return res.json;
  }

  private static list(body: any): any[] {
    const d = Array.isArray(body) ? body : body?.data ?? body?.users ?? body?.items ?? body?.results ?? body?.domains ?? [];
    return Array.isArray(d) ? d : [];
  }

  private static customer(raw: any): MaxPlayerCustomer {
    let r = raw?.data !== undefined && raw?.data !== null ? raw.data : raw?.user ?? raw?.customer ?? raw;
    if (Array.isArray(r)) r = r[0];
    if (r && !r.id && !r.user_id && !r.customer_id && (r.user || r.customer)) r = r.user ?? r.customer;
    return {
      id: String(r?.id ?? r?.user_id ?? r?.customer_id ?? ""),
      username: r?.username ?? null,
      email: r?.email ?? r?.user_email ?? null,
      expiresAt: r?.expiration ?? r?.expires_at ?? r?.exp_date ?? null,
      raw: r,
    };
  }

  status(): Promise<any> {
    return this.req("GET", "/status");
  }

  async domains(): Promise<Array<{ id: string; label: string }>> {
    const body = await this.req("GET", "/domains");
    return MaxPlayerClient.list(body).map((d: any) => ({
      id: String(d?.id ?? d?.domain_id ?? ""),
      label: String(d?.label || d?.domain || d?.name || `Domain ${d?.id}`),
    })).filter((d) => d.id);
  }

  deviceCeiling(): Promise<any> {
    return this.req("GET", "/device-ceiling");
  }

  async searchByUsername(username: string): Promise<MaxPlayerCustomer[]> {
    const body = await this.req("POST", "/users/search?limit=100", { username });
    return MaxPlayerClient.list(body).map((u) => MaxPlayerClient.customer(u));
  }

  async createUser(input: { domainId: string; iptvUser: string; iptvPass: string; email?: string; fullname?: string; maxDevices?: number; maxProfiles?: number }): Promise<MaxPlayerCustomer> {
    const payload: Record<string, unknown> = { domain_id: input.domainId, iptv_user: input.iptvUser, iptv_pass: input.iptvPass };
    if (input.email) payload.user_email = input.email;
    if (input.fullname) payload.fullname = input.fullname;
    if (input.maxDevices) payload.max_devices = input.maxDevices;
    if (input.maxProfiles) payload.max_profiles = input.maxProfiles;
    const body = await this.req("POST", "/users", payload);
    const c = MaxPlayerClient.customer(body);
    if (!c.id) {
      // Show what MaxPlayer answered, so the reason is visible in the panel (never contains the token).
      const answer = redact(typeof body === "string" ? body : JSON.stringify(body ?? null), [this.apiKey, input.iptvPass]).slice(0, 300);
      throw new MaxPlayerError(`MaxPlayer did not return the new account id. Answer: ${answer}`, false);
    }
    return c;
  }

  async updateList(input: { userId: string; domainId: string; iptvUser: string; iptvPass: string }): Promise<void> {
    await this.req("PUT", "/users/list", { user_id: input.userId, domain_id: input.domainId, iptv_username: input.iptvUser, iptv_password: input.iptvPass });
  }

  /**
   * All customer accounts (GET /users, 100 per page, continued with after_id).
   * Returns the IPTV usernames that already have a MaxPlayer account → MaxPlayer user id.
   */
  async iptvUsernames(maxPages = 200): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const body = await this.req("GET", `/users?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`);
      const rows = MaxPlayerClient.list(body);
      if (!rows.length) break;
      for (const r of rows) {
        const id = String(r?.id ?? r?.user_id ?? "");
        if (!id) continue;
        const names = [r?.username, r?.iptv_user, r?.iptv_username, ...(Array.isArray(r?.lists) ? r.lists.flatMap((l: any) => [l?.iptv_username, l?.username, l?.iptv_user]) : [])];
        for (const n of names) if (typeof n === "string" && n && !out.has(n)) out.set(n, id);
      }
      const last = String(rows[rows.length - 1]?.id ?? "");
      const more = body?.has_more ?? body?.hasMore;
      if (more === false || rows.length < 100 || !last || last === after) break;
      after = body?.next_cursor ? String(body.next_cursor) : last;
    }
    return out;
  }

  /** Deletes the customer account. Already deleted (404) counts as success. */
  async deleteCustomer(id: string): Promise<void> {
    try {
      await this.req("DELETE", `/users/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof MaxPlayerError && e.statusCode === 404) return;
      throw e;
    }
  }

  async getCustomer(id: string): Promise<MaxPlayerCustomer | null> {
    try {
      return MaxPlayerClient.customer(await this.req("GET", `/customers/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof MaxPlayerError && e.statusCode === 404) return null;
      throw e;
    }
  }

  /**
   * Idempotent activation: reuse a customer whose username equals the IPTV username
   * (MaxPlayer uses iptv_user as the account username when none is given), otherwise create one.
   */
  async ensureCustomer(input: { domainId: string; iptvUser: string; iptvPass: string; email?: string; fullname?: string; maxDevices?: number; maxProfiles?: number }): Promise<{ id: string; created: boolean }> {
    const existing = (await this.searchByUsername(input.iptvUser)).find((c) => c.username === input.iptvUser && c.id);
    if (existing) {
      await this.updateList({ userId: existing.id, domainId: input.domainId, iptvUser: input.iptvUser, iptvPass: input.iptvPass });
      return { id: existing.id, created: false };
    }
    const created = await this.createUser(input);
    return { id: created.id, created: true };
  }
}
