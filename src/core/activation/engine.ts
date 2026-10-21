import { alternativeUsername, isUsernameTakenError } from "../usernames";
import { addDays, computeRenewalExpiry } from "../dates";
import { generateLinePassword, generateLineUsername } from "../ids";
import { PanelAdapter, PanelApiError, PanelConfig } from "../adapters/types";
import { MaxPlayerError } from "../adapters/maxplayer";

/**
 * Activation engine — pure business logic, persistence is injected (ActivationStore),
 * so the exact same code runs in the worker (Prisma store) and in tests (memory store).
 *
 * Guarantees:
 *  - One paid order creates at most one line:
 *      * the order is claimed with a DB lease (no two workers run it concurrently)
 *      * username/password/expiry are planned and persisted BEFORE calling the panel
 *      * on retry, the engine looks the planned username up on the panel before creating
 *  - Completed orders are never re-run.
 *  - Suspended resellers / disabled billing put the order ON_HOLD (no external calls).
 */

export interface PackageSnapshot {
  packageId: string;
  name: string;
  durationDays: number;
  maxConnections: number;
  bouquetIds: string[]; // external (panel) bouquet ids
  maxPlayerEnabled: boolean;
  isTrial?: boolean;
  /** Package id on the XUI panel (needed when the panel is connected with a reseller API key). */
  panelPackageId?: string | null;
  /** Reseller's note for the line (written to the line's notes on the panel). */
  panelNote?: string | null;
  priceMinor: number;
  currency: string;
  billingType: "ONE_TIME" | "RECURRING";
}

export type ClaimableStatus = "PAID" | "ACTIVATING" | "ACTIVATION_FAILED" | "ON_HOLD";

export interface ActivationContext {
  order: {
    id: string;
    number: string;
    kind: "NEW" | "RENEWAL";
    status: string;
    attempts: number;
    snapshot: PackageSnapshot;
    lineUsername: string | null;
    linePassword: string | null; // decrypted
    plannedExpiresAt: Date | null;
    subscriptionId: string | null;
    customerEmail: string;
    /** Online purchase: a taken username becomes username+2 digits. Manual orders fail instead (the reseller chose it). */
    autoRenameTakenUsername?: boolean;
  };
  subscription: {
    id: string;
    xuiLineId: string | null;
    lineUsername: string | null;
    expiresAt: Date | null;
    /** NONE = this line has no MaxPlayer account (renewals must not create one). */
    maxPlayerStatus?: string;
  } | null;
  panel: { id: string; type: string; testMode: boolean; config: PanelConfig };
  reseller: { id: string; active: boolean; billingEnabled: boolean; linePrefix: string };
  platformBillingEnabled: boolean;
}

export interface ActivationStore {
  load(orderId: string): Promise<ActivationContext | null>;
  /** Atomically move a claimable order to ACTIVATING with a lease. Returns false if not claimable/locked. */
  claim(orderId: string, leaseMs: number, now: Date): Promise<boolean>;
  savePlan(orderId: string, plan: { username?: string; password?: string; expiresAt: Date }): Promise<void>;
  completeNew(orderId: string, r: { lineId: string; username: string; password: string; startsAt: Date; expiresAt: Date; test: boolean }): Promise<{ subscriptionId: string }>;
  completeRenewal(orderId: string, r: { subscriptionId: string; expiresAt: Date }): Promise<void>;
  fail(orderId: string, message: string, final: boolean): Promise<void>;
  hold(orderId: string, reason: string): Promise<void>;
}

export type PanelFactory = (panel: ActivationContext["panel"], resellerId: string, orderId: string) => PanelAdapter;

export type ActivationResult =
  | { status: "completed"; subscriptionId: string; lineId: string; expiresAt: Date; maxPlayer: boolean; test: boolean }
  | { status: "already_completed" | "not_found" | "not_paid" | "locked" }
  | { status: "on_hold"; reason: string }
  | { status: "failed"; error: string; retryable: boolean; final: boolean };

const CLAIMABLE = new Set<string>(["PAID", "ACTIVATING", "ACTIVATION_FAILED", "ON_HOLD"]);

export async function activateOrder(
  orderId: string,
  deps: { store: ActivationStore; panelFactory: PanelFactory; now?: () => Date; isFinalAttempt?: boolean; leaseMs?: number },
): Promise<ActivationResult> {
  const now = deps.now ?? (() => new Date());
  const ctx = await deps.store.load(orderId);
  if (!ctx) return { status: "not_found" };
  if (ctx.order.status === "COMPLETED") return { status: "already_completed" };
  if (!CLAIMABLE.has(ctx.order.status)) return { status: "not_paid" };

  if (!ctx.platformBillingEnabled || !ctx.reseller.active || !ctx.reseller.billingEnabled) {
    const reason = !ctx.platformBillingEnabled
      ? "Billing service is globally paused by the platform administrator"
      : !ctx.reseller.active
        ? "Reseller account is suspended"
        : "Billing module is disabled for this reseller";
    await deps.store.hold(orderId, reason);
    return { status: "on_hold", reason };
  }

  if (!(await deps.store.claim(orderId, deps.leaseMs ?? 5 * 60_000, now()))) return { status: "locked" };

  const panel = deps.panelFactory(ctx.panel, ctx.reseller.id, orderId);
  const snap = ctx.order.snapshot;

  try {
    const isRenewal = ctx.order.kind === "RENEWAL" && ctx.subscription?.xuiLineId;

    if (isRenewal) {
      const sub = ctx.subscription!;
      let expiresAt = ctx.order.plannedExpiresAt ?? computeRenewalExpiry(sub.expiresAt, now(), snap.durationDays);
      // A plan from an earlier attempt that is already (almost) over would set an expired date: plan again from now.
      if (ctx.order.plannedExpiresAt && expiresAt.getTime() < now().getTime() + 60 * 60_000) expiresAt = computeRenewalExpiry(sub.expiresAt, now(), snap.durationDays);
      if (!ctx.order.plannedExpiresAt || expiresAt.getTime() !== ctx.order.plannedExpiresAt.getTime()) {
        await deps.store.savePlan(orderId, { expiresAt });
      }
      // Absolute expiry → repeating this call is harmless. The reseller API extends by the panel
      // package duration and reports the real new expiry, which is what we store.
      const actual = await panel.setLineExpiry(sub.xuiLineId!, expiresAt, { bouquetIds: snap.bouquetIds, maxConnections: snap.maxConnections, panelPackageId: snap.panelPackageId });
      if (actual instanceof Date && !isNaN(actual.getTime())) expiresAt = actual;
      await panel.enableLine(sub.xuiLineId!);
      await deps.store.completeRenewal(orderId, { subscriptionId: sub.id, expiresAt });
      // Renewals never create a MaxPlayer account for a line that has none (e.g. a line imported
      // from the panel whose customer does not use the app) — only existing accounts are refreshed.
      return { status: "completed", subscriptionId: sub.id, lineId: sub.xuiLineId!, expiresAt, maxPlayer: snap.maxPlayerEnabled && (sub.maxPlayerStatus ?? "NONE") !== "NONE", test: ctx.panel.testMode };
    }

    // NEW line (or renewal of a subscription that never got a line)
    const hadPlan = !!(ctx.order.lineUsername && ctx.order.linePassword && ctx.order.plannedExpiresAt);
    const username = ctx.order.lineUsername ?? generateLineUsername(ctx.reseller.linePrefix);
    const password = ctx.order.linePassword ?? generateLinePassword();
    let expiresAt = ctx.order.plannedExpiresAt ?? addDays(now(), snap.durationDays);
    if (!hadPlan) await deps.store.savePlan(orderId, { username, password, expiresAt });

    let lineId: string | null = null;
    let panelExpiry: Date | null = null;
    let finalUser = username;
    let finalPass = password;
    if (hadPlan && !ctx.panel.testMode) {
      // A previous attempt may have created the line before crashing.
      const found = await panel.findLineByUsername(username);
      // Never take over someone else's line with the same username: the password must match.
      const existing = found && (found.password === undefined || found.password === password) ? found : null;
      if (found && !existing) throw new PanelApiError(`Username "${username}" is already used by another line on the panel. Choose a different username.`, false);
      if (existing) {
        lineId = existing.id;
        await panel.setLineExpiry(existing.id, expiresAt, { bouquetIds: snap.bouquetIds, maxConnections: snap.maxConnections, panelPackageId: snap.panelPackageId });
      }
    }
    if (!lineId) {
      // The line is created now, so it gets the full package duration from now. A plan saved by an
      // earlier attempt (retried hours later, order was on hold) must never shorten it or make it
      // already expired on the panel.
      const fresh = addDays(now(), snap.durationDays);
      if (expiresAt.getTime() < fresh.getTime() - 60 * 60_000) {
        expiresAt = fresh;
        await deps.store.savePlan(orderId, { expiresAt });
      }
      const create = (u: string) =>
        panel.createLine({
          username: u,
          password,
          maxConnections: snap.maxConnections,
          expiresAt,
          bouquetIds: snap.bouquetIds,
          isTrial: snap.isTrial,
          panelPackageId: snap.panelPackageId,
          notes: snap.panelNote ? `${snap.panelNote} (${ctx.order.number})` : `Order ${ctx.order.number} · ${ctx.order.customerEmail}`,
        });
      let created;
      try {
        created = await create(username);
      } catch (e) {
        // First attempt only (no earlier attempt could have created it): the chosen username belongs
        // to someone else on the panel → use the same name + 2 digits instead of failing a paid order.
        if (!ctx.order.autoRenameTakenUsername || hadPlan || !(e instanceof PanelApiError) || e.retryable || !isUsernameTakenError(e.message)) throw e;
        const alt = alternativeUsername(username);
        await deps.store.savePlan(orderId, { username: alt, password, expiresAt });
        created = await create(alt);
      }
      lineId = created.lineId;
      finalUser = created.username;
      finalPass = created.password;
      // Reseller API: the panel set the expiry from its package — billing shows that same date.
      if (created.expiresAt instanceof Date && !isNaN(created.expiresAt.getTime()) && created.expiresAt.getTime() > now().getTime()) panelExpiry = created.expiresAt;
    }

    const finalExpiry = panelExpiry ?? expiresAt;
    const { subscriptionId } = await deps.store.completeNew(orderId, {
      lineId,
      username: finalUser,
      password: finalPass,
      startsAt: now(),
      expiresAt: finalExpiry,
      test: ctx.panel.testMode,
    });
    return { status: "completed", subscriptionId, lineId, expiresAt: finalExpiry, maxPlayer: snap.maxPlayerEnabled, test: ctx.panel.testMode };
  } catch (e: any) {
    const retryable = e instanceof PanelApiError ? e.retryable : true;
    const final = !!deps.isFinalAttempt || !retryable;
    const message = String(e?.message ?? e).slice(0, 500);
    await deps.store.fail(orderId, message, final);
    return { status: "failed", error: message, retryable, final };
  }
}

// ---------------------------------------------------------------------------
// MaxPlayer activation (separate job: a MaxPlayer failure never undoes the XUI line or payment)

export interface MaxPlayerContext {
  subscription: { id: string; lineUsername: string | null; linePassword: string | null; maxPlayerUserId: string | null; customerEmail: string; customerName: string | null };
  integration: { apiKey: string; domainId: string | null; enabled: boolean; testMode: boolean; maxDevices: number | null; maxProfiles: number | null } | null;
  reseller: { active: boolean; billingEnabled: boolean };
}

export interface MaxPlayerStore {
  load(subscriptionId: string): Promise<MaxPlayerContext | null>;
  markPending(subscriptionId: string): Promise<void>;
  markActive(subscriptionId: string, maxPlayerUserId: string): Promise<void>;
  markFailed(subscriptionId: string, message: string): Promise<void>;
  /** Still to be created (PENDING) — with a note why it is waiting, e.g. MaxPlayer's request limit. */
  markWaiting(subscriptionId: string, message: string): Promise<void>;
}

export interface MaxPlayerApi {
  ensureCustomer(input: { domainId: string; iptvUser: string; iptvPass: string; email?: string; fullname?: string; maxDevices?: number; maxProfiles?: number }): Promise<{ id: string; created: boolean }>;
  updateList(input: { userId: string; domainId: string; iptvUser: string; iptvPass: string }): Promise<void>;
}

export type MaxPlayerResult =
  | { status: "skipped"; reason: string }
  | { status: "active"; maxPlayerUserId: string; created: boolean; test: boolean }
  | { status: "failed"; error: string; retryable: boolean }
  /** MaxPlayer said "too many requests": nothing failed, the account is made when the queue resumes. */
  | { status: "rate_limited"; error: string; retryAfterMs: number };

/** Pause after a "too many requests" answer when MaxPlayer does not say how long to wait. */
export const MAXPLAYER_RATE_LIMIT_PAUSE_MS = 90_000;

/** Ids given to accounts "created" in test mode — no real MaxPlayer account exists for them. */
export function isSimulatedMaxPlayerId(id: string | null | undefined): boolean {
  return !!id && id.startsWith("TEST-");
}

export async function activateMaxPlayer(subscriptionId: string, deps: { store: MaxPlayerStore; client: (apiKey: string) => MaxPlayerApi }): Promise<MaxPlayerResult> {
  const ctx = await deps.store.load(subscriptionId);
  if (!ctx) return { status: "skipped", reason: "subscription not found" };
  const integ = ctx.integration;
  // Configuration problems are written to the subscription, so the reseller sees why no account was
  // made (instead of an account silently staying "pending" forever). Retry works once it is fixed.
  if (!integ) {
    const reason = "MaxPlayer is not connected: open the MaxPlayer page, save your API token, then Retry.";
    await deps.store.markFailed(subscriptionId, reason);
    return { status: "skipped", reason };
  }
  if (!integ.enabled) {
    const reason = "MaxPlayer is switched off: MaxPlayer page → tick “Enabled” → Save, then Retry.";
    await deps.store.markFailed(subscriptionId, reason);
    return { status: "skipped", reason };
  }
  if (!ctx.reseller.active || !ctx.reseller.billingEnabled) return { status: "skipped", reason: "reseller suspended or billing disabled" };
  const { lineUsername, linePassword } = ctx.subscription;
  if (!lineUsername || !linePassword) {
    const reason = "The line has no username/password saved, so no MaxPlayer account can be made.";
    await deps.store.markFailed(subscriptionId, reason);
    return { status: "skipped", reason };
  }
  if (!integ.domainId) {
    await deps.store.markFailed(subscriptionId, "MaxPlayer domain_id is not configured");
    return { status: "failed", error: "MaxPlayer domain_id is not configured", retryable: false };
  }
  // An id from test mode is not a real account: in live mode it is replaced by a real one.
  const knownId = isSimulatedMaxPlayerId(ctx.subscription.maxPlayerUserId) ? null : ctx.subscription.maxPlayerUserId;
  await deps.store.markPending(subscriptionId);
  if (integ.testMode) {
    const id = knownId ?? `TEST-MP-${subscriptionId.slice(-8)}`;
    await deps.store.markActive(subscriptionId, id);
    return { status: "active", maxPlayerUserId: id, created: !knownId, test: true };
  }
  try {
    const api = deps.client(integ.apiKey);
    if (knownId) {
      try {
        await api.updateList({ userId: knownId, domainId: integ.domainId, iptvUser: lineUsername, iptvPass: linePassword });
        await deps.store.markActive(subscriptionId, knownId);
        return { status: "active", maxPlayerUserId: knownId, created: false, test: false };
      } catch (e) {
        // The account was deleted on MaxPlayer → create it again below; other errors are reported.
        if (!(e instanceof MaxPlayerError && e.statusCode === 404)) throw e;
      }
    }
    const r = await api.ensureCustomer({
      domainId: integ.domainId,
      iptvUser: lineUsername,
      iptvPass: linePassword,
      // Internal placeholder addresses (lines without an email) are never sent to MaxPlayer.
      email: /@imported\.invalid$/i.test(ctx.subscription.customerEmail) ? undefined : ctx.subscription.customerEmail,
      fullname: ctx.subscription.customerName ?? undefined,
      maxDevices: integ.maxDevices ?? undefined,
      maxProfiles: integ.maxProfiles ?? undefined,
    });
    await deps.store.markActive(subscriptionId, r.id);
    return { status: "active", maxPlayerUserId: r.id, created: r.created, test: false };
  } catch (e: any) {
    const message = String(e?.message ?? e).slice(0, 500);
    if (e instanceof MaxPlayerError && e.rateLimited) {
      const wait = e.retryAfterMs ?? MAXPLAYER_RATE_LIMIT_PAUSE_MS;
      await deps.store.markWaiting(subscriptionId, `MaxPlayer request limit reached — waiting ${Math.ceil(wait / 60_000)} min, then it continues automatically. (${message})`.slice(0, 500));
      return { status: "rate_limited", error: message, retryAfterMs: wait };
    }
    await deps.store.markFailed(subscriptionId, message);
    return { status: "failed", error: message, retryable: e instanceof MaxPlayerError ? e.retryable : true };
  }
}
