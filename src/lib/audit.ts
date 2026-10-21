import { db } from "./db";

export interface AuditEntry {
  actor?: { id: string; email: string; role: string } | null;
  resellerId?: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only audit trail. Never pass secrets in meta. */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorUserId: e.actor?.id ?? null,
        actorEmail: e.actor?.email ?? null,
        actorRole: e.actor?.role ?? "SYSTEM",
        resellerId: e.resellerId ?? null,
        action: e.action,
        target: e.target ?? null,
        meta: (e.meta as any) ?? undefined,
        ip: e.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed", (err as Error).message);
  }
}

export function apiLogger(resellerId: string | null, service: string, orderId?: string | null) {
  return (e: { action: string; success: boolean; statusCode?: number; durationMs?: number; message?: string }) => {
    db.apiLog
      .create({
        data: { resellerId, service, action: e.action, success: e.success, statusCode: e.statusCode ?? null, durationMs: e.durationMs ?? null, message: e.message?.slice(0, 1000) ?? null, orderId: orderId ?? null },
      })
      .catch((err) => console.error("[apilog]", err.message));
  };
}
