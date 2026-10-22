"use server";

import { decrypt, encrypt } from "@/core/crypto";
import { VodSourceError } from "@/core/vod";
import { act, bool, str, UserError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { actorOf, requireReseller } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueVodScan } from "@/lib/queue";
import { rateLimit } from "@/lib/ratelimit";
import { recheckSeries, testMonitoringLine } from "@/lib/vod";

const BACK = "/dashboard/vod";

async function vodReseller() {
  const r = await requireReseller();
  if (!r.reseller.vodMonitorEnabled) throw new UserError("VOD monitoring is not enabled for your account. Ask the platform administrator.");
  return r;
}

function normalizeServer(raw: string): string {
  let v = raw.trim();
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new UserError("Enter the server address, e.g. http://line.example.com:80");
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new UserError("Enter the server address, e.g. http://line.example.com:80");
  return `${u.protocol}//${u.host}`;
}

const sourceError = (e: unknown) => (e instanceof VodSourceError || (e instanceof Error && /private or internal|Cannot resolve/.test(e.message)) ? new UserError((e as Error).message) : e);

export async function saveVodLineAction(fd: FormData) {
  return act(BACK, async () => {
    const { user, reseller } = await vodReseller();
    const serverUrl = normalizeServer(str(fd, "serverUrl", 300));
    const username = str(fd, "username", 100);
    if (!username) throw new UserError("Enter the username of the monitoring line.");
    const existing = await db.vodMonitor.findUnique({ where: { resellerId: reseller.id } });
    const typed = str(fd, "password", 200);
    const password = typed || (existing ? decrypt(existing.passwordEnc) : "");
    if (!password) throw new UserError("Enter the password of the monitoring line.");
    if (!(await rateLimit(`vod-test:${reseller.id}`, 10, 600))) throw new UserError("Too many attempts. Please wait a few minutes.");
    let t: { series: number; expires: Date | null };
    try {
      t = await testMonitoringLine(serverUrl, username, password);
    } catch (e) {
      throw sourceError(e);
    }
    const data = { serverUrl, username, passwordEnc: encrypt(password), autoScan: bool(fd, "autoScan") };
    await db.vodMonitor.upsert({ where: { resellerId: reseller.id }, create: { resellerId: reseller.id, ...data }, update: data });
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "vod.line_saved", meta: { serverUrl, username, series: t.series } });
    const exp = t.expires ? ` The line is valid until ${t.expires.toISOString().slice(0, 10)} — keep it active.` : "";
    return `Line works: ${t.series} series found on the panel. Click “Scan now” to check them.${exp}`;
  });
}

export async function scanVodNowAction() {
  return act(BACK, async () => {
    const { user, reseller } = await vodReseller();
    const m = await db.vodMonitor.findUnique({ where: { resellerId: reseller.id } });
    if (!m) throw new UserError("Enter the monitoring line first.");
    if (m.status === "RUNNING" || m.status === "QUEUED") return "A scan is already running.";
    if (!(await rateLimit(`vod-scan:${reseller.id}`, 6, 3600))) throw new UserError("You can start at most 6 scans per hour.");
    await db.vodMonitor.update({ where: { resellerId: reseller.id }, data: { status: "QUEUED", progress: 0, lastError: null } });
    await enqueueVodScan(reseller.id);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "vod.scan_started" });
    return "Scan started. Big libraries take a few minutes — this page updates by itself.";
  });
}

export async function setVodTmdbAction(fd: FormData) {
  const back = str(fd, "back", 500) || BACK;
  return act(back.startsWith("/dashboard/vod") ? back : BACK, async () => {
    const { reseller } = await vodReseller();
    const id = str(fd, "id", 40);
    const raw = str(fd, "tmdb", 200);
    const tmdb = raw ? raw.match(/(\d{1,9})/)?.[1] ?? null : null;
    if (raw && !tmdb) throw new UserError("Enter the TMDB number, e.g. 1396 (or paste the themoviedb.org link).");
    const row = await db.vodSeries.findFirst({ where: { id, resellerId: reseller.id } });
    if (!row) throw new UserError("Series not found.");
    await db.vodSeries.update({ where: { id }, data: { tmdbOverride: tmdb } });
    if (!(await rateLimit(`vod-recheck:${reseller.id}`, 60, 600))) return "Saved. It is checked again in the next scan.";
    try {
      const status = await recheckSeries(reseller.id, id);
      return `“${row.name}” checked again: ${status.replace(/_/g, " ").toLowerCase()}.`;
    } catch (e) {
      throw sourceError(e);
    }
  });
}

export async function toggleVodIgnoreAction(fd: FormData) {
  const back = str(fd, "back", 500) || BACK;
  return act(back.startsWith("/dashboard/vod") ? back : BACK, async () => {
    const { reseller } = await vodReseller();
    const row = await db.vodSeries.findFirst({ where: { id: str(fd, "id", 40), resellerId: reseller.id } });
    if (!row) throw new UserError("Series not found.");
    await db.vodSeries.update({ where: { id: row.id }, data: { ignored: !row.ignored } });
    const missing = await db.vodSeries.count({ where: { resellerId: reseller.id, ignored: false, status: { in: ["MISSING", "NEW_EPISODE"] } } });
    await db.vodMonitor.updateMany({ where: { resellerId: reseller.id }, data: { missingCount: missing } });
    return row.ignored ? `“${row.name}” is monitored again.` : `“${row.name}” is no longer monitored.`;
  });
}

export async function deleteVodLineAction() {
  return act(BACK, async () => {
    const { user, reseller } = await vodReseller();
    await db.$transaction([db.vodSeries.deleteMany({ where: { resellerId: reseller.id } }), db.vodMonitor.deleteMany({ where: { resellerId: reseller.id } })]);
    await audit({ actor: actorOf(user), resellerId: reseller.id, action: "vod.line_removed" });
    return "Monitoring line and results removed.";
  });
}
