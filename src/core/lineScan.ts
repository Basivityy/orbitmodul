/**
 * "Import all my lines" for panels whose reseller API cannot list lines (get_lines is empty) but
 * can read one line by id (get_line). The scan walks the line ids and keeps only lines whose owner
 * (member_id) is the reseller's own panel account. Pure logic — the caller supplies the I/O.
 */
import type { LineInfo } from "./adapters/types";

/** After the highest own line found, keep looking this many ids further before stopping. */
export const SCAN_TAIL = 5000;
/** Ids checked per worker job (the job re-queues itself, so a restart resumes where it stopped). */
export const SCAN_CHUNK = 3000;

/** Last id to check: the panel's highest known id, or further when own lines keep turning up. */
export function scanEnd(s: { ceiling: number; lastHitId: number }): number {
  return Math.max(s.ceiling, s.lastHitId + SCAN_TAIL);
}

/** Highest line id seen on this panel (any reseller) + a margin, as the default upper bound. */
export function defaultCeiling(knownLineIds: Array<string | null>): number {
  const nums = knownLineIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? Math.max(...nums) + 2000 : 0;
}

export type Ownership = "mine" | "other" | "unknown";

/** A line is imported only when the panel says it belongs to this reseller's account. */
export function ownership(line: LineInfo, memberId: string): Ownership {
  if (!line.memberId) return "unknown";
  return line.memberId === memberId ? "mine" : "other";
}

export interface ScanResult {
  scanned: number;
  found: number;
  imported: number;
  updated: number;
  lastHitId: number;
  nextId: number;
  stopped: boolean;
}

export async function scanRange(opts: {
  from: number;
  to: number;
  memberId: string;
  concurrency?: number;
  getLine: (id: string) => Promise<LineInfo | null>;
  onMine: (line: LineInfo) => Promise<"imported" | "updated" | "skipped">;
  shouldStop?: () => boolean | Promise<boolean>;
  /** Called every 50 checked ids with the totals so far (for a live progress bar). */
  onProgress?: (r: ScanResult) => void | Promise<void>;
  pauseMs?: number;
}): Promise<ScanResult> {
  const r: ScanResult = { scanned: 0, found: 0, imported: 0, updated: 0, lastHitId: 0, nextId: opts.from, stopped: false };
  if (opts.to < opts.from) return r;
  let next = opts.from;
  let done = 0;
  const workers = Math.max(1, Math.min(opts.concurrency ?? 3, 8));
  const finished = new Set<number>();
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next <= opts.to && !r.stopped) {
        const id = next++;
        const line = await opts.getLine(String(id));
        if (line && ownership(line, opts.memberId) === "mine") {
          r.found++;
          r.lastHitId = Math.max(r.lastHitId, id);
          const what = await opts.onMine(line);
          if (what === "imported") r.imported++;
          else if (what === "updated") r.updated++;
        }
        r.scanned++;
        finished.add(id);
        // nextId = first id not yet finished (all ids below it are done) — safe resume point.
        while (finished.has(r.nextId)) finished.delete(r.nextId++);
        if (++done % 50 === 0) {
          if (opts.onProgress) await opts.onProgress({ ...r });
          if (opts.shouldStop && (await opts.shouldStop())) r.stopped = true;
        }
        if (opts.pauseMs) await new Promise((res) => setTimeout(res, opts.pauseMs));
      }
    }),
  );
  return r;
}

/** The panel (or its nginx) says "too busy": 503/502/504/429 — slow down and retry, never give up the import. */
export function isPanelBusy(e: unknown): boolean {
  const status = (e as { statusCode?: number })?.statusCode;
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  return /HTTP (429|502|503|504)|Service (Temporarily )?Unavailable|Too Many Requests|Bad Gateway|Gateway Time-?out/i.test(String((e as Error)?.message ?? ""));
}

/**
 * Shared by all parallel requests of a scan: after a "busy" answer every request waits a cooldown
 * and keeps a growing gap; the gap shrinks again while the panel answers normally.
 */
export class AdaptiveThrottle {
  gapMs = 0;
  private cooldownUntil = 0;
  constructor(private readonly maxGapMs = 3000, private readonly now: () => number = Date.now) {}

  /** How long the next request should wait. */
  waitMs(): number {
    return Math.max(this.cooldownUntil - this.now(), 0) + this.gapMs;
  }

  ok(): void {
    this.gapMs = Math.max(0, this.gapMs - 10);
  }

  busy(attempt: number): void {
    this.gapMs = Math.min(this.maxGapMs, this.gapMs + 250);
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + Math.min(60_000, 3000 * 2 ** attempt));
  }
}

export interface BillingLine {
  status: string;
  expiresAt: Date | null;
  lineUsername: string | null;
  maxConnections: number | null;
  panelNotes: string | null;
  panelTrial?: boolean;
  panelKind?: string;
}

/**
 * What changed on the panel for a line that is already in billing (renewed or disabled on the
 * panel, new notes…). Returns only the changed fields, or null when billing is up to date.
 * Status is only switched between ACTIVE and EXPIRED (other states are billing decisions).
 */
export function panelChanges(sub: BillingLine, line: LineInfo, now = new Date()): Partial<BillingLine> | null {
  const patch: Partial<BillingLine> = {};
  if (line.expiresAt && (!sub.expiresAt || Math.abs(line.expiresAt.getTime() - sub.expiresAt.getTime()) > 60_000)) patch.expiresAt = line.expiresAt;
  const expires = line.expiresAt ?? sub.expiresAt;
  const active = (!expires || expires > now) && line.enabled !== false;
  if ((sub.status === "ACTIVE" || sub.status === "EXPIRED") && sub.status !== (active ? "ACTIVE" : "EXPIRED")) patch.status = active ? "ACTIVE" : "EXPIRED";
  if (line.username && line.username !== sub.lineUsername) patch.lineUsername = line.username;
  if (line.maxConnections && line.maxConnections !== sub.maxConnections) patch.maxConnections = line.maxConnections;
  if ((line.notes ?? null) !== (sub.panelNotes ?? null)) patch.panelNotes = line.notes ?? null;
  if (line.isTrial !== undefined && line.isTrial !== !!sub.panelTrial) patch.panelTrial = line.isTrial;
  if (line.kind && line.kind !== (sub.panelKind ?? "line")) patch.panelKind = line.kind;
  return Object.keys(patch).length ? patch : null;
}
