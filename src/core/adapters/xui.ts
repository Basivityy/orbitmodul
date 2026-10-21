import { formEncode, httpRequest, HttpError, redact } from "../http";
import { assertPublicUrl } from "../net";
import {
  ApiCallLogger,
  ConnectionInfo,
  CreatedLine,
  CreateLineInput,
  LineInfo,
  NamedItem,
  PanelAdapter,
  PanelApiError,
  PanelConfig,
  PanelPackage,
} from "./types";

/** XUI One expects exp_date as "YYYY-MM-DD HH:MM" (verified on a live panel; unix seconds are rejected). */
export function toXuiDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** Converts an XUI package duration ("31","days" / "2","months" / "1","years" / "24","hours") to days. */
export function durationToDays(value: unknown, unit: unknown): number {
  const n = Number(value) || 0;
  switch (String(unit ?? "days").toLowerCase()) {
    case "hours":
    case "hour":
      return n > 0 ? Math.max(1, Math.ceil(n / 24)) : 0;
    case "months":
    case "month":
      return n * 30;
    case "years":
    case "year":
      return n * 365;
    default:
      return n;
  }
}

const DEFAULT_OUTPUTS = "[1,2,3]"; // m3u8 / ts / rtmp — as on existing panel lines

/** A new line the panel made with (almost) no time on it — e.g. a test package created with the wrong duration type. */
export function bornExpired(expiresAt: Date | null | undefined, now = Date.now()): boolean {
  // null = no expiry on XUI (unlimited), which is not expired.
  return !!expiresAt && expiresAt.getTime() < now + 5 * 60_000;
}

/**
 * Trial or normal line for a panel package. XUI gives a line the package's *trial* duration when
 * is_trial=1 and the *official* duration otherwise — so the type whose duration is 0 would create an
 * already expired line (the "24h test package" bug). Use the type that has a duration.
 */
export function chooseTrial(wantTrial: boolean, pkg: { official_duration?: unknown; official_duration_in?: unknown; trial_duration?: unknown; trial_duration_in?: unknown } | null | undefined): boolean {
  if (!pkg) return wantTrial;
  const official = durationToDays(pkg.official_duration, pkg.official_duration_in);
  const trial = durationToDays(pkg.trial_duration, pkg.trial_duration_in);
  if (wantTrial && trial === 0 && official > 0) return false;
  if (!wantTrial && official === 0 && trial > 0) return true;
  return wantTrial;
}

/**
 * XUI One API adapter (admin / reseller API access codes).
 *
 * Request format (documented): {base}/<access-code>/?api_key=<KEY>&action=<ACTION>
 * Actions: user_info, get_bouquets, get_packages / packages, get_lines, get_line,
 *   create_line, edit_line, enable_line, disable_line
 * Write format verified on a live XUI One panel (admin API):
 *   POST form fields, exp_date = "YYYY-MM-DD HH:MM", bouquets_selected = "[1,2]" (JSON string),
 *   member_id = owning reseller; the response contains the full line (data.id).
 * edit_line is sent with the complete line state so no field is reset.
 */
export class XuiOneAdapter implements PanelAdapter {
  readonly type = "XUI_ONE";

  constructor(private readonly cfg: PanelConfig, private readonly log: ApiCallLogger = () => {}) {}

  private endpoint(action: string, query: Record<string, string> = {}): string {
    const base = this.cfg.apiUrl.trim();
    const url = new URL(base.endsWith("/") ? base : base + "/");
    url.searchParams.set("api_key", this.cfg.apiKey);
    url.searchParams.set("action", action);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url.toString();
  }

  private async call(action: string, opts: { query?: Record<string, string>; form?: Record<string, any> } = {}): Promise<any> {
    const url = this.endpoint(action, opts.query);
    try {
      await assertPublicUrl(url); // SSRF guard: reseller-supplied URL
    } catch (e) {
      this.log({ action, success: false, message: (e as Error).message });
      throw new PanelApiError((e as Error).message, false);
    }
    let res;
    try {
      res = await httpRequest(url, {
        method: opts.form ? "POST" : "GET",
        headers: opts.form ? { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" } : { Accept: "application/json" },
        body: opts.form ? formEncode(opts.form) : undefined,
        timeoutMs: this.cfg.timeoutMs ?? 20_000,
      });
    } catch (e) {
      const msg = e instanceof HttpError ? e.message : String(e);
      this.log({ action, success: false, message: redact(msg, [this.cfg.apiKey]) });
      throw new PanelApiError(msg, true);
    }

    const body = res.json;
    if (!res.ok) {
      const msg = `HTTP ${res.status}: ${redact(res.text.slice(0, 300), [this.cfg.apiKey])}`;
      this.log({ action, success: false, statusCode: res.status, durationMs: res.durationMs, message: msg });
      // 5xx / 429 are transient; 4xx means a request or auth problem
      throw new PanelApiError(msg, res.status >= 500 || res.status === 429, res.status);
    }
    if (body === null) {
      const msg = `Invalid (non-JSON) response: ${redact(res.text.slice(0, 200), [this.cfg.apiKey])}`;
      this.log({ action, success: false, statusCode: res.status, durationMs: res.durationMs, message: msg });
      throw new PanelApiError(msg, false, res.status);
    }
    if (!Array.isArray(body) && typeof body === "object" && "status" in body && body.status !== "STATUS_SUCCESS") {
      const msg = String(body.error ?? body.message ?? body.status ?? "Unknown API error");
      this.log({ action, success: false, statusCode: res.status, durationMs: res.durationMs, message: redact(msg, [this.cfg.apiKey]) });
      throw new PanelApiError(msg, false, res.status);
    }
    this.log({ action, success: true, statusCode: res.status, durationMs: res.durationMs });
    return body;
  }

  /** Lists may come back as a bare array, {data: [...]}, or {data: {id: {...}}}. */
  private static asList(body: any): any[] {
    const data = Array.isArray(body) ? body : body?.data ?? body?.items ?? [];
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") return Object.values(data);
    return [];
  }

  private static toNamed(items: any[], nameKeys: string[]): NamedItem[] {
    return items
      .map((it) => {
        const id = it?.id ?? it?.bouquet_id ?? it?.package_id;
        const name = nameKeys.map((k) => it?.[k]).find((v) => typeof v === "string" && v.length > 0);
        return id === undefined || id === null ? null : { id: String(id), name: name ?? `#${id}` };
      })
      .filter((x): x is NamedItem => x !== null);
  }

  private static toLine(raw: any): LineInfo | null {
    if (!raw || typeof raw !== "object") return null;
    const id = raw.id ?? raw.line_id;
    if (id === undefined || id === null) return null;
    const exp = raw.exp_date;
    let expiresAt: Date | null = null;
    if (exp !== null && exp !== undefined && exp !== "") {
      const n = Number(exp);
      expiresAt = Number.isFinite(n) && n > 0 ? new Date(n * 1000) : isNaN(Date.parse(String(exp))) ? null : new Date(String(exp));
    }
    const enabled = raw.enabled === undefined ? (raw.admin_enabled === undefined ? null : Number(raw.admin_enabled) === 1) : Number(raw.enabled) === 1 || raw.enabled === true;
    return {
      id: String(id),
      username: String(raw.username ?? ""),
      password: raw.password !== undefined ? String(raw.password) : undefined,
      expiresAt,
      enabled,
      maxConnections: raw.max_connections !== undefined ? Number(raw.max_connections) : null,
      memberId: raw.member_id !== undefined && raw.member_id !== null ? String(raw.member_id) : null,
    };
  }

  async testConnection(): Promise<ConnectionInfo> {
    const body = await this.call("user_info");
    const data = body?.data ?? body;
    const credits = data?.credits !== undefined ? String(data.credits) : null;
    const username = data?.username !== undefined ? String(data.username) : null;
    const memberId = data?.id !== undefined && data?.id !== null ? String(data.id) : null;
    return { ok: true, credits, username, memberId, message: username ? `Connected as ${username}` : "Connected" };
  }

  async getCredits(): Promise<string | null> {
    return (await this.testConnection()).credits;
  }

  private static isInvalidAction(e: unknown): boolean {
    return e instanceof PanelApiError && /invalid action/i.test(e.message);
  }

  /** Raw package list: admin API uses `get_packages`, XUI reseller API uses `packages`. */
  private async packageList(): Promise<any[]> {
    try {
      return XuiOneAdapter.asList(await this.call("get_packages"));
    } catch (e) {
      if (!XuiOneAdapter.isInvalidAction(e)) throw e;
      return XuiOneAdapter.asList(await this.call("packages"));
    }
  }

  private static parseIds(v: unknown): string[] {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return v.split(",").map((x) => x.trim()).filter(Boolean);
      }
    }
    return [];
  }

  /**
   * Admin API: `get_bouquets` returns ids + names.
   * Reseller API has no bouquet action, so bouquet ids are collected from the packages
   * (each package lists its bouquets); names are placeholders the reseller can rename,
   * or are filled from an optional admin API ("names source").
   */
  async getBouquets(): Promise<NamedItem[]> {
    try {
      return XuiOneAdapter.toNamed(XuiOneAdapter.asList(await this.call("get_bouquets")), ["bouquet_name", "name", "title"]);
    } catch (e) {
      if (!XuiOneAdapter.isInvalidAction(e)) throw e;
    }
    const seen = new Map<string, NamedItem>();
    for (const p of await this.packageList()) {
      for (const id of XuiOneAdapter.parseIds(p?.bouquets)) {
        if (!seen.has(id)) seen.set(id, { id, name: `Bouquet #${id}`, placeholder: true });
      }
    }
    return Array.from(seen.values()).sort((a, b) => Number(a.id) - Number(b.id));
  }

  /** Admin API only: panel users (resellers) for choosing who owns new lines. */
  async getUsers(): Promise<Array<{ id: string; username: string; credits: string | null }>> {
    return XuiOneAdapter.asList(await this.call("get_users")).map((u) => ({ id: String(u.id), username: String(u.username ?? ""), credits: u.credits !== undefined ? String(u.credits) : null }));
  }

  async getPackages(): Promise<NamedItem[]> {
    return XuiOneAdapter.toNamed(await this.packageList(), ["package_name", "name", "title"]);
  }

  async getPanelPackages(): Promise<PanelPackage[]> {
    return (await this.packageList())
      .filter((p) => p && p.id !== undefined && Number(p.is_addon ?? 0) !== 1)
      .map((p) => {
        // Same rule as when a line is created: the line type (trial/normal) whose duration is set.
        const official = durationToDays(p.official_duration, p.official_duration_in);
        const isTrial = official === 0 || chooseTrial(Number(p.is_trial ?? 0) === 1, p);
        const days = isTrial ? durationToDays(p.trial_duration, p.trial_duration_in) || official || 1 : official;
        return {
          id: String(p.id),
          name: String(p.package_name ?? p.name ?? `Package ${p.id}`),
          durationDays: days,
          credits: Number(p.official_credits ?? 0) || 0,
          maxConnections: Math.max(1, Number(p.max_connections ?? 1) || 1),
          bouquetIds: XuiOneAdapter.parseIds(p.bouquets),
          isTrial,
        };
      });
  }

  /** True when the URL points to the XUI reseller API (lines must be created from a panel package). */
  get isResellerApi(): boolean {
    try {
      return /reseller/i.test(new URL(this.cfg.apiUrl).pathname);
    } catch {
      return false;
    }
  }

  async createLine(input: CreateLineInput): Promise<CreatedLine> {
    if (this.isResellerApi) return this.createLineReseller(input);
    const form: Record<string, any> = {
      allowed_outputs: DEFAULT_OUTPUTS,
      ...(this.cfg.extraParams ?? {}),
      username: input.username,
      password: input.password,
      max_connections: input.maxConnections,
      exp_date: toXuiDate(input.expiresAt),
      is_trial: input.isTrial ? 1 : 0,
      bouquets_selected: JSON.stringify(input.bouquetIds.map((b) => Number(b))),
    };
    if (this.cfg.lineOwnerId) form.member_id = this.cfg.lineOwnerId;
    if (input.notes) {
      form.admin_notes = input.notes;
      form.reseller_notes = input.notes;
    }
    const body = await this.call("create_line", { form });
    const data = body?.data ?? {};
    const lineId = data.id ?? data.line_id ?? body?.line_id ?? body?.id;
    if (lineId === undefined || lineId === null) throw new PanelApiError("create_line succeeded but returned no line id", false);
    const username = String(data.username ?? input.username);
    await this.ensureNotBornExpiredAdmin(String(lineId), username, input);
    return { lineId: String(lineId), username, password: String(data.password ?? input.password) };
  }

  /** One line in "XUI API calls" per new line: the expiry the panel really gave it (for checking at a glance). */
  private logNewLine(username: string, planned: Date | null, actual: Date | null | undefined, trial: boolean, note?: string): void {
    const fmt = (d: Date) => `${toXuiDate(d)} UTC`;
    this.log({
      action: "check_new_line",
      success: !bornExpired(actual),
      message: `${username}: panel expiry ${actual ? fmt(actual) : "none (unlimited)"}${planned ? ` · billing ${fmt(planned)}` : ""} · ${trial ? "trial" : "normal"} line${note ? ` · ${note}` : ""}`,
    });
  }

  /**
   * Admin API: the expiry is sent explicitly, but some panels ignore it (e.g. for trial lines) and
   * create the line already expired. Check it and set the package expiry again — first as it is,
   * then without the trial flag. Still expired → a clear error instead of a dead line for the customer.
   */
  private async ensureNotBornExpiredAdmin(lineId: string, username: string, input: CreateLineInput): Promise<void> {
    const line = await this.getLine(lineId).catch(() => null);
    if (!line) return;
    this.logNewLine(username, input.expiresAt, line.expiresAt, !!input.isTrial, bornExpired(line.expiresAt) ? "panel made it expired → setting the package expiry again" : undefined);
    if (!bornExpired(line.expiresAt)) return;
    // Absolute expiry → every attempt is harmless to repeat. Tried: the verified date format, then unix
    // seconds (some panel versions), each first with the line type as created, then as a normal line.
    const formats: Array<"date" | "unix"> = ["date", "unix"];
    const trials = input.isTrial ? [1, 0] : [0];
    for (const trialFlag of trials) {
      for (const fmt of formats) {
        const got = await this.call("get_line", { query: { id: lineId } }).catch(() => null);
        const cur = got?.data ?? got;
        if (!cur || typeof cur !== "object") break;
        try {
          await this.call("edit_line", {
            form: {
              id: lineId,
              username: cur.username ?? username,
              password: cur.password ?? input.password,
              member_id: cur.member_id,
              max_connections: input.maxConnections,
              exp_date: fmt === "date" ? toXuiDate(input.expiresAt) : String(Math.floor(input.expiresAt.getTime() / 1000)),
              is_trial: trialFlag,
              bouquets_selected: JSON.stringify(input.bouquetIds.map((b) => Number(b))),
              allowed_outputs: cur.allowed_outputs && cur.allowed_outputs !== "[]" ? String(cur.allowed_outputs) : DEFAULT_OUTPUTS,
            },
          });
        } catch (e) {
          if (e instanceof PanelApiError && e.retryable) throw e; // panel down → normal retry later
          continue; // this format/type was refused → next one
        }
        const after = (await this.getLine(lineId))?.expiresAt;
        if (!bornExpired(after)) {
          this.logNewLine(username, input.expiresAt, after, trialFlag === 1, `fixed (${fmt === "date" ? "date" : "unix time"}${trialFlag ? ", trial" : ", normal line"})`);
          return;
        }
      }
    }
    throw new PanelApiError(`The XUI panel created line "${username}" already expired and did not accept the package expiry. Check the package duration on the panel.`, false);
  }


  /**
   * Reseller API: the panel takes duration, connections and bouquets from the panel package
   * (verified live: without `package` it answers STATUS_INVALID_PACKAGE).
   */
  private async createLineReseller(input: CreateLineInput): Promise<CreatedLine> {
    if (!input.panelPackageId) {
      throw new PanelApiError("This package is not linked to a package on your XUI panel. Open Packages & prices → the package → choose “Panel package”, or use “Import packages from panel”.", false);
    }
    // Trial or normal line: whichever of the package's durations is set (never one with 0 → expired line).
    const pkg = (await this.packageList().catch(() => [] as any[])).find((p) => String(p?.id) === String(input.panelPackageId)) ?? null;
    const trial = chooseTrial(!!input.isTrial, pkg);
    // The XUI.ONE reseller API reads the trial flag as `trial=1` (field-tested on 1.5.13); `is_trial`
    // is ignored there, which made a test package's line a normal one with 0 duration → born expired.
    // Both names are sent, in the query and the form, so every panel version gets it.
    const trialParams: Record<string, string> = trial ? { trial: "1", is_trial: "1" } : {};
    const form: Record<string, any> = {
      ...(this.cfg.extraParams ?? {}),
      username: input.username,
      password: input.password,
      package: input.panelPackageId,
      is_trial: trial ? 1 : 0,
      ...(trial ? { trial: 1 } : {}),
      ...(input.notes ? { reseller_notes: input.notes } : {}),
    };
    const body = await this.call("create_line", { form, query: trialParams });
    const data = body?.data ?? {};
    let lineId = data.id ?? data.line_id ?? body?.line_id ?? body?.id;
    if (lineId === undefined || lineId === null) {
      // Some reseller API versions return only a status — look the new line up by username.
      lineId = (await this.findLineByUsername(input.username))?.id;
    }
    if (lineId === undefined || lineId === null) throw new PanelApiError("create_line succeeded but returned no line id", false);
    const id = String(lineId);
    const username = String(data.username ?? input.username);
    const password = String(data.password ?? input.password);
    // The panel sets the expiry from the package: read it, so billing shows the same date as the panel.
    let expiresAt = XuiOneAdapter.toLine(data)?.expiresAt ?? null;
    expiresAt = (await this.getLine(id).catch(() => null))?.expiresAt ?? expiresAt;
    if (bornExpired(expiresAt)) {
      // Apply the package to the line once more (renewing from now) — as the line type that has a duration.
      this.logNewLine(username, null, expiresAt, trial, "panel made it expired → applying the package again");
      const official = pkg ? durationToDays(pkg.official_duration, pkg.official_duration_in) : 0;
      const trialDays = pkg ? durationToDays(pkg.trial_duration, pkg.trial_duration_in) : 0;
      const attempts = [trial, !trial].filter((t) => !pkg || (t ? trialDays > 0 : official > 0));
      for (const t of attempts) {
        try {
          const res = await this.call("edit_line", {
            form: { ...(this.cfg.extraParams ?? {}), id, username, password, package: input.panelPackageId, is_trial: t ? 1 : 0, ...(t ? { trial: 1 } : {}) },
            query: t ? { trial: "1", is_trial: "1" } : {},
          });
          expiresAt = (await this.getLine(id).catch(() => null))?.expiresAt ?? XuiOneAdapter.toLine(res?.data)?.expiresAt ?? expiresAt;
        } catch (e) {
          if (e instanceof PanelApiError && e.retryable) throw e;
        }
        if (!bornExpired(expiresAt)) break;
      }
    }
    this.logNewLine(username, null, expiresAt, trial, bornExpired(expiresAt) ? "still expired → line removed again" : undefined);
    if (bornExpired(expiresAt)) {
      // Never leave a dead line on the panel: it would also block the same username on Retry.
      await this.deleteLine(id).catch(() => undefined);
      throw new PanelApiError(`The XUI panel created line "${username}" already expired (panel package #${input.panelPackageId}), so it was removed again. On the panel check the package duration (e.g. 24 hours for a test package), then click Retry.`, false);
    }
    return { lineId: id, username, password, expiresAt };
  }


  /** Reads the current line and re-sends its full state with the new expiry (nothing is reset). */
  async setLineExpiry(lineId: string, expiresAt: Date, extra: { bouquetIds?: string[]; maxConnections?: number; panelPackageId?: string | null } = {}): Promise<Date | void> {
    const body = await this.call("get_line", { query: { id: lineId } });
    const cur = body?.data ?? body;
    if (!cur || typeof cur !== "object" || !cur.username) throw new PanelApiError(`Line ${lineId} was not found on the panel`, false);
    if (this.isResellerApi) return this.extendLineReseller(lineId, cur, expiresAt, extra.panelPackageId);
    const bouquets = extra.bouquetIds && extra.bouquetIds.length ? JSON.stringify(extra.bouquetIds.map((b) => Number(b))) : String(cur.bouquet ?? "[]");
    const outputs = cur.allowed_outputs && cur.allowed_outputs !== "[]" ? String(cur.allowed_outputs) : DEFAULT_OUTPUTS;
    const form: Record<string, any> = {
      id: lineId,
      username: cur.username,
      password: cur.password,
      member_id: cur.member_id,
      max_connections: extra.maxConnections ?? cur.max_connections ?? 1,
      exp_date: toXuiDate(expiresAt),
      is_trial: cur.is_trial ?? 0,
      bouquets_selected: bouquets,
      allowed_outputs: outputs,
    };
    await this.call("edit_line", { form });
  }

  /**
   * Reseller API: a line is extended by applying a panel package to it (edit_line + package);
   * the panel adds the package duration and takes the credits. That is not idempotent, so the
   * current expiry is read first: if the line already reaches the target date (a previous
   * attempt succeeded), nothing is sent again.
   */
  private async extendLineReseller(lineId: string, cur: any, target: Date, panelPackageId?: string | null): Promise<Date | void> {
    const current = XuiOneAdapter.toLine(cur)?.expiresAt;
    // Verified live: edit_line + package adds the package duration (e.g. 31 days) and answers with the updated line.
    // Already extended (a retry after success)? Tolerance covers 30 vs 31 day packages but never a whole duration.
    if (current) {
      const tolerance = Math.min(3 * 86_400_000, Math.max(3600_000, (target.getTime() - current.getTime()) / 2));
      if (current.getTime() >= target.getTime() - tolerance) return current;
    }
    if (!panelPackageId) throw new PanelApiError("This package is not linked to a package on your XUI panel (needed to extend lines with a reseller API key). Open the package and choose “Panel package”.", false);
    const res = await this.call("edit_line", { form: { ...(this.cfg.extraParams ?? {}), id: lineId, username: cur.username, password: cur.password, package: panelPackageId } });
    const after = XuiOneAdapter.toLine(res?.data)?.expiresAt ?? (await this.getLine(lineId))?.expiresAt;
    return after ?? undefined;
  }

  /**
   * All lines visible to this API key, page by page (the panel returns at most ~50 per call).
   * `complete` is false when the panel ignored the paging parameters (only the first page could be read).
   */
  async listLines(opts: { pageSize?: number; maxPages?: number } = {}): Promise<{ lines: LineInfo[]; complete: boolean }> {
    const size = opts.pageSize ?? 50;
    const maxPages = opts.maxPages ?? 400;
    const seen = new Map<string, LineInfo>();
    for (let page = 0; page < maxPages; page++) {
      const rows = XuiOneAdapter.asList(await this.call("get_lines", { query: { start: String(page * size), limit: String(size) } }));
      const lines = rows.map((r) => XuiOneAdapter.toLine(r)).filter((l): l is LineInfo => l !== null);
      const fresh = lines.filter((l) => !seen.has(l.id));
      for (const l of fresh) seen.set(l.id, l);
      // Fewer rows than a page → last page. More than a page on the first call → the panel ignored `limit` and returned everything.
      if (lines.length === 0 || lines.length < size || (page === 0 && lines.length > size)) return { lines: Array.from(seen.values()), complete: true };
      if (fresh.length === 0) return { lines: Array.from(seen.values()), complete: page > 0 ? false : true };
    }
    return { lines: Array.from(seen.values()), complete: false };
  }

  async enableLine(lineId: string): Promise<void> {
    await this.call("enable_line", { form: { id: lineId } });
  }

  async disableLine(lineId: string): Promise<void> {
    await this.call("disable_line", { form: { id: lineId } });
  }

  async deleteLine(lineId: string): Promise<void> {
    try {
      await this.call("delete_line", { form: { id: lineId }, query: { id: lineId } });
    } catch (e) {
      // Already gone on the panel → nothing left to delete.
      if (e instanceof PanelApiError && !e.retryable && (await this.getLine(lineId)) === null) return;
      throw e;
    }
  }

  async getLine(lineId: string): Promise<LineInfo | null> {
    try {
      const body = await this.call("get_line", { query: { id: lineId } });
      return XuiOneAdapter.toLine(body?.data ?? body);
    } catch (e) {
      if (e instanceof PanelApiError && !e.retryable) return null;
      throw e;
    }
  }

  async findLineByUsername(username: string): Promise<LineInfo | null> {
    // Fast path: server-side search; then walk all pages (get_lines returns ~50 rows per call).
    const quick = XuiOneAdapter.asList(await this.call("get_lines", { query: { search: username } })).find((l) => String(l?.username ?? "") === username);
    if (quick) return XuiOneAdapter.toLine(quick);
    const { lines } = await this.listLines();
    return lines.find((l) => l.username === username) ?? null;
  }
}

/**
 * Test mode wrapper: read-only calls go to the real panel, write calls are simulated
 * and never touch real customer lines.
 */
export class SimulatedPanelAdapter implements PanelAdapter {
  readonly type: string;
  private counter = 0;
  constructor(private readonly inner: PanelAdapter, private readonly log: ApiCallLogger = () => {}) {
    this.type = inner.type + ":TEST";
  }
  testConnection() { return this.inner.testConnection(); }
  getBouquets() { return this.inner.getBouquets(); }
  getPackages() { return this.inner.getPackages(); }
  getPanelPackages() { return this.inner.getPanelPackages(); }
  getCredits() { return this.inner.getCredits(); }
  async createLine(input: CreateLineInput): Promise<CreatedLine> {
    this.log({ action: "create_line (simulated)", success: true, message: "Test mode — no real line created" });
    return { lineId: `TEST-${Date.now().toString(36)}-${++this.counter}`, username: input.username, password: input.password };
  }
  async setLineExpiry(): Promise<Date | void> { this.log({ action: "edit_line (simulated)", success: true, message: "Test mode" }); }
  async enableLine(): Promise<void> { this.log({ action: "enable_line (simulated)", success: true, message: "Test mode" }); }
  async disableLine(): Promise<void> { this.log({ action: "disable_line (simulated)", success: true, message: "Test mode" }); }
  async deleteLine(): Promise<void> { this.log({ action: "delete_line (simulated)", success: true, message: "Test mode — no real line deleted" }); }
  async getLine(lineId: string): Promise<LineInfo | null> {
    return lineId.startsWith("TEST-") ? { id: lineId, username: "", expiresAt: null, enabled: true, maxConnections: null } : this.inner.getLine(lineId);
  }
  async findLineByUsername(): Promise<LineInfo | null> { return null; }
  listLines(opts?: { pageSize?: number; maxPages?: number }) { return this.inner.listLines(opts); }
  /** Read-only lookup against the real panel (used to find existing customers). */
  lookupLine(username: string) { return this.inner.findLineByUsername(username); }
}

export function createPanelAdapter(type: string, cfg: PanelConfig, opts: { testMode: boolean; log?: ApiCallLogger }): PanelAdapter {
  let adapter: PanelAdapter;
  switch (type) {
    case "XUI_ONE":
      adapter = new XuiOneAdapter(cfg, opts.log);
      break;
    default:
      throw new Error(`Unsupported panel type: ${type}`);
  }
  return opts.testMode ? new SimulatedPanelAdapter(adapter, opts.log) : adapter;
}
