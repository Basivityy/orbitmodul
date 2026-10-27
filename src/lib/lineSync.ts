import { decrypt, encrypt } from "@/core/crypto";
import { createPanelAdapter } from "@/core/adapters/xui";
import { PanelApiError, type LineInfo } from "@/core/adapters/types";
import { AdaptiveThrottle, isPanelBusy, panelChanges } from "@/core/lineScan";
import { db } from "./db";
import { getSetting, setSetting } from "./settings";

/**
 * "Refresh from panel": re-reads every line of a reseller that is in billing (get_line by id) and
 * takes over what changed on the panel — renewed or disabled there, connections, notes, password.
 * Runs once a day by itself and on demand. Read-only for the panel.
 */
export interface LineSyncState {
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
  at: string;
  checked: number;
  total: number;
  updated: number;
  missing: number;
  /** What the panel said about the lines it returned (for comparing with the panel's lists). */
  breakdown?: Record<string, number>;
  error?: string;
}

export const syncKey = (resellerId: string) => `linesync:${resellerId}`;

export async function getLineSync(resellerId: string): Promise<LineSyncState | null> {
  return getSetting<LineSyncState | null>(syncKey(resellerId), null);
}

async function save(resellerId: string, s: LineSyncState) {
  await setSetting(syncKey(resellerId), s);
}

export async function markSyncQueued(resellerId: string) {
  const prev = await getLineSync(resellerId);
  await save(resellerId, { status: "QUEUED", at: new Date().toISOString(), checked: 0, total: prev?.total ?? 0, updated: 0, missing: 0 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncResellerLines(resellerId: string): Promise<LineSyncState> {
  const state: LineSyncState = { status: "RUNNING", at: new Date().toISOString(), checked: 0, total: 0, updated: 0, missing: 0, breakdown: {} };
  const tally = (k: string) => (state.breakdown![k] = (state.breakdown![k] ?? 0) + 1);
  const panels = await db.panelIntegration.findMany({ where: { resellerId } });
  const subs = await db.subscription.findMany({
    where: { resellerId, isTest: false, xuiLineId: { not: null }, status: { in: ["ACTIVE", "EXPIRED"] } },
    select: { id: true, panelId: true, xuiLineId: true, status: true, expiresAt: true, lineUsername: true, linePasswordEnc: true, maxConnections: true, panelNotes: true, panelTrial: true, panelKind: true },
  });
  state.total = subs.length;
  const missingSubs: Array<{ id: string; panelNotes: string | null }> = [];
  await save(resellerId, state);
  try {
    for (const panel of panels) {
      if (panel.testMode) continue;
      const adapter = createPanelAdapter(panel.type, { apiUrl: panel.apiUrl, apiKey: decrypt(panel.apiKeyEnc), extraParams: (panel.extraParams as Record<string, string>) ?? {}, lineOwnerId: panel.lineOwnerId }, { testMode: false, log: () => undefined });
      const memberId = /reseller/i.test(panel.apiUrl) ? (await adapter.testConnection()).memberId ?? null : null;
      const throttle = new AdaptiveThrottle();
      const getLine = async (id: string): Promise<LineInfo | null> => {
        for (let attempt = 0; ; attempt++) {
          const w = throttle.waitMs();
          if (w) await sleep(w);
          try {
            const l = await adapter.getLine(id);
            throttle.ok();
            return l;
          } catch (e) {
            if (isPanelBusy(e) && attempt < 8) {
              throttle.busy(attempt);
              continue;
            }
            if (attempt < 2 && e instanceof PanelApiError && e.retryable) {
              await sleep(2000 * (attempt + 1));
              continue;
            }
            throw e;
          }
        }
      };
      const mine = subs.filter((s) => s.panelId === panel.id);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, mine.length) }, async () => {
          while (next < mine.length) {
            const s = mine[next++];
            const line = await getLine(s.xuiLineId!);
            state.checked++;
            if (!line || (memberId && line.memberId && line.memberId !== memberId)) {
              // Deleted on the panel (or moved to another reseller) — decided after the run (safety check).
              state.missing++;
              missingSubs.push(s);
            } else {
              tally(line.kind ?? "line");
              if (line.isTrial) tally("trial");
              if (line.enabled === false) tally("disabled");
              if (!line.expiresAt) tally("no expiry");
              const patch = panelChanges(s, line);
              const pass = line.password && (!s.linePasswordEnc || decrypt(s.linePasswordEnc) !== line.password) ? { linePasswordEnc: encrypt(line.password) } : {};
              if (patch || Object.keys(pass).length) {
                await db.subscription.update({ where: { id: s.id }, data: { ...(patch ?? {}), ...pass, ...(patch?.status === "ACTIVE" ? { reminderSentAt: null } : {}) } as never });
                state.updated++;
              }
            }
            if (state.checked % 50 === 0) await save(resellerId, state);
          }
        }),
      );
    }
    // Safety: if many lines "disappeared" at once, the panel is more likely broken than cleaned up —
    // nothing is changed then. Otherwise those lines no longer count as lines of this store.
    if (missingSubs.length > 10 && missingSubs.length > state.checked * 0.2) {
      state.error = `${missingSubs.length} lines were not found on the panel — nothing was changed. Check the panel connection.`;
    } else {
      for (const m of missingSubs) {
        await db.subscription.update({ where: { id: m.id }, data: { status: "CANCELED", panelNotes: [m.panelNotes, "Not found on the panel (deleted there)"].filter(Boolean).join(" · ").slice(0, 500) } });
      }
    }
    state.status = state.error ? "ERROR" : "DONE";
  } catch (e) {
    state.status = "ERROR";
    state.error = String((e as Error).message).slice(0, 300);
  }
  state.at = new Date().toISOString();
  await save(resellerId, state);
  return state;
}
