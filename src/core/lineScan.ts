/**
 * "Import all my lines" for panels whose reseller API cannot list lines (get_lines is empty) but
 * can read one line by id (get_line). The scan walks the line ids and keeps only lines whose owner
 * (member_id) is the reseller's own panel account. Pure logic — the caller supplies the I/O.
 */
import type { LineInfo } from "./adapters/types";

/** After the highest own line found, keep looking this many ids further before stopping. */
export const SCAN_TAIL = 5000;
/** Ids checked per worker job (the job re-queues itself, so a restart resumes where it stopped). */
export const SCAN_CHUNK = 1500;

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
